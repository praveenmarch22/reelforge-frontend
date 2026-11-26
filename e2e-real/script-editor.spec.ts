import {expect, test, type Page} from '@playwright/test';
import {
  answered,
  call,
  chooseOption,
  credits,
  draftProject,
  getEstimate,
  getProject,
  narration,
  narrations,
  newCreator,
  savedNarrations,
  sceneCard,
  setBalance,
  summary,
  voices,
} from './helpers';

// Script editor (docs/SCREENS_F5_F6.md section 2) against the real backend with mock AI providers.
// Each test starts from a project whose script the backend has written (4 scenes from the mock model).

async function openDraft(page: Page, topic = 'Morning walks') {
  const user = await newCreator(page);
  const project = await draftProject(page, topic);
  await page.goto(`/app/p/${project.id}/script`);
  const first = [...project.scenes].sort((a, b) => a.position - b.position)[0];
  await expect(narration(page, 1)).toHaveValue(first.narration);
  return {user, project};
}

const savedScene = (page: Page, id: string) => answered(page, 'PATCH', new RegExp(`/api/v1/scenes/${id}$`));

test('edits autosave (after typing stops, and on blur) and are there after a reload', async ({page}) => {
  const {project} = await openDraft(page);
  const [s1, s2] = [...project.scenes].sort((a, b) => a.position - b.position);

  // Title: Enter saves.
  const title = page.getByRole('textbox', {name: 'Title'});
  await title.fill('Walk it off');
  const titleSaved = answered(page, 'PATCH', new RegExp(`/api/v1/projects/${project.id}$`));
  await title.press('Enter');
  expect((await titleSaved).status()).toBe(200);

  // Narration: saved after typing stops, without leaving the field.
  const n1 = narration(page, 1);
  await n1.click();
  await n1.press('End');
  const typed = savedScene(page, s1.id);
  await n1.pressSequentially(' Every single day.');
  expect((await typed).status()).toBe(200);
  await expect(n1).toBeFocused();

  // On-screen text: saved when the field loses focus.
  const onScreen = sceneCard(page, 2).getByRole('textbox', {name: 'Scene 2 on-screen text'});
  await onScreen.fill('WALK MORE');
  const blurred = savedScene(page, s2.id);
  await onScreen.press('Tab');
  expect((await blurred).status()).toBe(200);

  // Mood.
  const moodSaved = savedScene(page, s2.id);
  await sceneCard(page, 2).getByRole('combobox', {name: 'Scene 2 mood'}).selectOption('mysterious');
  expect((await moodSaved).status()).toBe(200);

  // A long scene warns.
  const longText = Array.from({length: 40}, (_, i) => `word${i}`).join(' ');
  const n3 = narration(page, 3);
  await n3.fill(longText);
  await expect(sceneCard(page, 3).getByText(/Over 15 seconds/)).toBeVisible();
  const longSaved = savedScene(page, project.scenes.find((s) => s.position === 3)!.id);
  await n3.blur();
  expect((await longSaved).status()).toBe(200);

  await page.reload();
  await expect(page.getByRole('textbox', {name: 'Title'})).toHaveValue('Walk it off');
  await expect(narration(page, 1)).toHaveValue(`${s1.narration} Every single day.`);
  await expect(page.getByRole('textbox', {name: 'Scene 2 on-screen text'})).toHaveValue('WALK MORE');
  await expect(page.getByRole('combobox', {name: 'Scene 2 mood'})).toHaveValue('mysterious');
  await expect(narration(page, 3)).toHaveValue(longText);
  const saved = await getProject(page, project.id);
  await expect(summary(page).getByText(String(saved.wordCount), {exact: true})).toBeVisible();
  await expect(summary(page).getByText(`${saved.estimatedSeconds.toFixed(1)}s`)).toBeVisible();
});

test.describe('with every scene on screen (dragging needs the source and the target visible)', () => {
  test.use({viewport: {width: 1280, height: 1300}});

  test('scene actions: rewrite with its cost, duplicate, delete, move by keyboard, drag, add', async ({page}) => {
    const {project} = await openDraft(page);
    const {costs, balance} = await credits(page);
    const original = await savedNarrations(page, project.id);

    // Rewrite scene 2 (C6).
    await sceneCard(page, 2).getByRole('button', {name: 'Rewrite', exact: true}).click();
    await sceneCard(page, 2).getByRole('textbox', {name: 'How should scene 2 change?'}).fill('make it punchier');
    await sceneCard(page, 2).getByRole('button', {name: `Rewrite · ${costs.rewrite} credit${costs.rewrite === 1 ? '' : 's'}`}).click();
    await expect(narration(page, 2)).toHaveValue(`${original[1].replace(/[.!?]$/, '')}, and that is the point.`);
    expect((await credits(page)).balance).toBe(balance - costs.rewrite);
    const afterRewrite = await savedNarrations(page, project.id);

    // Duplicate scene 1 (C4): the copy comes right after it.
    await sceneCard(page, 1).getByRole('button', {name: 'More actions for scene 1'}).click();
    await page.getByRole('menuitem', {name: 'Duplicate'}).click();
    await expect(page.getByRole('textbox', {name: /^Scene \d+ narration$/})).toHaveCount(5);
    expect(await narrations(page)).toEqual([afterRewrite[0], afterRewrite[0], ...afterRewrite.slice(1)]);

    // Delete the copy (C3), after confirming.
    page.once('dialog', (d) => {
      expect(d.message()).toBe('Delete scene 2?');
      void d.accept();
    });
    await sceneCard(page, 2).getByRole('button', {name: 'More actions for scene 2'}).click();
    await page.getByRole('menuitem', {name: 'Delete'}).click();
    await expect(page.getByRole('textbox', {name: /^Scene \d+ narration$/})).toHaveCount(4);
    expect(await narrations(page)).toEqual(afterRewrite);

    // Move scene 1 down with the keyboard only (C5).
    await sceneCard(page, 1).getByRole('button', {name: 'Rewrite', exact: true}).focus();
    await page.keyboard.press('Tab');
    await expect(sceneCard(page, 1).getByRole('button', {name: 'More actions for scene 1'})).toBeFocused();
    await page.keyboard.press('Enter');
    // The menu opens on its first available item: Move down (Move up is off for the first scene).
    await expect(page.getByRole('menuitem', {name: 'Move down'})).toBeFocused();
    const moved = answered(page, 'POST', /\/scenes\/reorder$/);
    await page.keyboard.press('Enter');
    expect((await moved).status()).toBe(200);
    const order1 = [afterRewrite[1], afterRewrite[0], afterRewrite[2], afterRewrite[3]];
    await expect.poll(() => narrations(page)).toEqual(order1);

    // Drag scene 4 by its handle onto scene 1.
    const dragged = answered(page, 'POST', /\/scenes\/reorder$/);
    await sceneCard(page, 4).getByTitle('Drag to reorder').dragTo(sceneCard(page, 1));
    expect((await dragged).status()).toBe(200);
    const order2 = [order1[3], order1[0], order1[1], order1[2]];
    await expect.poll(() => narrations(page)).toEqual(order2);

    // Add a scene at the end (C1).
    await expect(page.getByText('4 of 30 scenes')).toBeVisible();
    await page.getByRole('textbox', {name: 'New scene narration'}).fill('And one more thing.');
    await page.getByRole('button', {name: 'Add scene'}).click();
    await expect(narration(page, 5)).toHaveValue('And one more thing.');
    await expect(page.getByText('5 of 30 scenes')).toBeVisible();

    await page.reload();
    await expect(narration(page, 5)).toHaveValue('And one more thing.');
    expect(await narrations(page)).toEqual([...order2, 'And one more thing.']);
    expect(await savedNarrations(page, project.id)).toEqual([...order2, 'And one more thing.']);
  });
});

test('at 30 scenes, Add scene is disabled', async ({page}) => {
  await newCreator(page);
  const project = await draftProject(page);
  for (let i = project.scenes.length; i < 30; i++) {
    const added = await call(page, 'POST', `/projects/${project.id}/scenes`, {narration: `Extra scene ${i + 1}.`});
    expect(added.status).toBe(201);
  }
  await page.goto(`/app/p/${project.id}/script`);
  await expect(narration(page, 30)).toHaveValue('Extra scene 30.');
  await expect(page.getByText('30 of 30 scenes')).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'New scene narration'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Add scene'})).toBeDisabled();
});

test('hooks (B9), the estimate (B10), the narrator (B5) and rewriting the whole script (B8)', async ({page}) => {
  const {project} = await openDraft(page);

  // The estimate panel shows B10's credits and balance.
  const estimate = await getEstimate(page, project.id);
  await expect(summary(page).getByText(`${estimate.credits} credit${estimate.credits === 1 ? '' : 's'}`, {exact: true})).toBeVisible();
  await expect(summary(page).getByText(`${estimate.balance} credits left.`)).toBeVisible();

  // Another opening for scene 1.
  await sceneCard(page, 1).getByRole('button', {name: 'Try another opening'}).click();
  const openings = page.getByRole('list', {name: 'Other openings'});
  await expect(openings.getByRole('button')).toHaveCount(3);
  const second = (await openings.getByRole('button').nth(1).textContent())!.trim();
  await openings.getByRole('button').nth(1).click();
  await expect(narration(page, 1)).toHaveValue(second);
  await expect.poll(async () => (await savedNarrations(page, project.id))[0]).toBe(second);

  // The narrator.
  const george = (await voices(page)).find((v) => v.name === 'George')!;
  const changed = answered(page, 'PATCH', new RegExp(`/api/v1/projects/${project.id}$`));
  await chooseOption(summary(page).getByRole('combobox', {name: 'Narrator'}), /^George/);
  expect((await changed).status()).toBe(200);
  expect((await getProject(page, project.id)).voiceId).toBe(george.id);
  await page.reload();
  await expect(summary(page).getByRole('combobox', {name: 'Narrator'})).toHaveValue(george.id);

  // Rewrite the whole script: the scenes are replaced, the title is kept.
  const before = await savedNarrations(page, project.id);
  await page.getByRole('button', {name: 'Rewrite whole script'}).click();
  await page.getByRole('textbox', {name: 'What should change'}).fill('more upbeat');
  const started = answered(page, 'POST', /\/script\/regenerate$/);
  await page.getByRole('button', {name: 'Write a new script'}).click();
  expect((await started).status()).toBe(202);
  // Done when the project is a draft again with no job running; the new scenes replace the old.
  await expect
    .poll(async () => {
      const p = await getProject(page, project.id);
      return p.status === 'draft' && p.activeJobs.length === 0 && p.scenes[0]?.narration !== undefined;
    })
    .toBe(true);
  const after = await savedNarrations(page, project.id);
  expect(after).toHaveLength(4);
  expect(after).not.toEqual(before);
  expect(after[0]).not.toBe(second); // the hook chosen above was replaced by the new script
  await expect.poll(() => narrations(page)).toEqual(after);
  await expect(page.getByText('Writing your script…')).toBeHidden();
  await expect(page.getByRole('textbox', {name: 'Title'})).toHaveValue(project.title);
});

test('Generate Reel sends an Idempotency-Key, reserves the estimate and opens the Reel editor', async ({page}) => {
  const {project} = await openDraft(page);
  const estimate = await getEstimate(page, project.id);
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/projects/${project.id}/generate`));
  const response = answered(page, 'POST', /\/generate$/);
  await summary(page).getByRole('button', {name: 'Generate Reel'}).click();
  const key = (await request).headers()['idempotency-key'];
  expect(key).toMatch(/^[\w:.-]{1,100}$/);
  const answer = await response;
  expect(answer.status()).toBe(202);
  expect((await answer.json()).creditsReserved).toBe(estimate.credits);
  await expect(page).toHaveURL(new RegExp(`/app/p/${project.id}/edit$`));
  expect(['generating', 'ready', 'needs_attention']).toContain((await getProject(page, project.id)).status);
});

test('Generate Reel without enough credits shows what is needed and stays', async ({page}) => {
  const {user, project} = await openDraft(page);
  const estimate = await getEstimate(page, project.id);
  expect(estimate.credits).toBeGreaterThan(0);
  setBalance(user.id, 0);
  const response = answered(page, 'POST', /\/generate$/);
  await summary(page).getByRole('button', {name: 'Generate Reel'}).click();
  expect((await response).status()).toBe(402);
  await expect(summary(page).getByText(`This needs ${estimate.credits} credits and you have 0.`, {exact: false})).toBeVisible();
  await expect(page).toHaveURL(/\/script$/);
});

test('typing while an earlier autosave is on its way never loses characters', async ({page}) => {
  const {project} = await openDraft(page);
  const s1 = [...project.scenes].sort((a, b) => a.position - b.position)[0];

  // Hold the first narration save so there is time to keep typing, as on a slow connection.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let saves = 0;
  await page.route(new RegExp(`/api/v1/scenes/${s1.id}$`), async (route) => {
    saves += 1;
    if (saves === 1) await gate;
    await route.continue();
  });

  // Record every value the box shows from now on.
  await page.evaluate((id) => {
    const seen: string[] = [];
    (window as unknown as {seen: string[]}).seen = seen;
    const tick = () => {
      const v = (document.getElementById(id) as HTMLTextAreaElement | null)?.value ?? '';
      if (seen[seen.length - 1] !== v) seen.push(v);
      requestAnimationFrame(tick);
    };
    tick();
  }, `narration-${s1.id}`);

  const box = narration(page, 1);
  await box.click();
  await box.press('End');
  const first = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/scenes/${s1.id}`));
  await box.pressSequentially(' abc');
  await first;
  await box.pressSequentially('def');
  const firstAnswer = answered(page, 'PATCH', new RegExp(`/scenes/${s1.id}$`));
  const secondAnswer = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/scenes/${s1.id}`) && (r.request().postData() ?? '').includes('abcdef'),
  );
  release();
  await firstAnswer;
  await secondAnswer;
  await expect(box).toHaveValue(`${s1.narration} abcdef`);

  const seen = await page.evaluate(() => (window as unknown as {seen: string[]}).seen);
  const afterDef = seen.slice(seen.indexOf(`${s1.narration} abcdef`));
  expect(afterDef.filter((v) => !v.endsWith('abcdef')), 'values shown after "def" was typed').toEqual([]);
  expect((await getProject(page, project.id)).scenes.find((s) => s.id === s1.id)!.narration).toBe(`${s1.narration} abcdef`);
});

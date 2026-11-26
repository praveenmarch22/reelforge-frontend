import {expect, test, type Page} from '@playwright/test';
import {
  call,
  credits,
  draftProject,
  getProject,
  MOCK_FAIL,
  narration,
  narrations,
  newCreator,
  savedNarrations,
  sceneCard,
  summary,
} from './helpers';

// Round 2 of F5 (docs/qa/FIX_LOG_F5.md): autosave before leaving and before actions, failure
// notices, Shorten with AI, the scene menu, the top bar and the phone layout. Real backend, mock AI.

async function openDraft(page: Page, extra: Record<string, unknown> = {}) {
  await newCreator(page);
  const project = await draftProject(page, 'Morning walks', extra);
  await page.goto(`/app/p/${project.id}/script`);
  const first = [...project.scenes].sort((a, b) => a.position - b.position)[0];
  await expect(narration(page, 1)).toHaveValue(first.narration);
  return project;
}

const sceneId = async (page: Page, projectId: string, position: number) =>
  (await getProject(page, projectId)).scenes.find((s) => s.position === position)!.id;

/** Resolves with "dialog" if the page asks before closing, or "closed" if it just closes. */
async function closeAndSeeIfAsked(page: Page): Promise<'dialog' | 'closed'> {
  const asked = new Promise<'dialog'>((resolve) =>
    page.once('dialog', (d) => {
      if (d.type() === 'beforeunload') {
        resolve('dialog');
        void d.dismiss(); // stay on the page
      }
    }),
  );
  const closed = new Promise<'closed'>((resolve) => page.once('close', () => resolve('closed')));
  await page.close({runBeforeUnload: true});
  return Promise.race([asked, closed]);
}

test('Generate right after typing generates the text on screen; the top bar shows the balance', async ({page}) => {
  const project = await openDraft(page);
  const {balance, monthlyAllowance} = await credits(page);
  await expect(page.getByRole('link', {name: `${balance} of ${monthlyAllowance} credits left`})).toBeVisible();

  const s1 = await sceneId(page, project.id, 1);
  const order: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() !== 'GET' && path.startsWith('/api/v1/')) order.push(`${r.method()} ${path}`);
  });
  const box = narration(page, 1);
  await box.click();
  await box.press('End');
  await box.pressSequentially(' Right now.');
  await summary(page).getByRole('button', {name: 'Generate Reel'}).click();
  await expect(page).toHaveURL(new RegExp(`/app/p/${project.id}/edit$`));

  const saved = (await getProject(page, project.id)).scenes.find((s) => s.id === s1)!;
  expect(saved.narration.endsWith(' Right now.')).toBe(true);
  expect(order.indexOf(`PATCH /api/v1/scenes/${s1}`)).toBeGreaterThanOrEqual(0);
  expect(order.indexOf(`PATCH /api/v1/scenes/${s1}`)).toBeLessThan(order.indexOf(`POST /api/v1/projects/${project.id}/generate`));
});

test('leaving the editor right after typing keeps the edit', async ({page}) => {
  const project = await openDraft(page);
  const s2 = await sceneId(page, project.id, 2);
  const box = narration(page, 2);
  await box.click();
  await box.press('End');
  await box.pressSequentially(' Kept.');
  await page.getByRole('navigation', {name: 'Breadcrumb'}).getByRole('link', {name: 'Projects'}).click();
  await expect(page).toHaveURL(/\/app\/projects$/);
  await expect
    .poll(async () => (await getProject(page, project.id)).scenes.find((s) => s.id === s2)!.narration)
    .toMatch(/ Kept\.$/);
});

test('closing the tab while a save is on its way asks first', async ({page}) => {
  const project = await openDraft(page);
  const s1 = await sceneId(page, project.id, 1);
  await page.route(new RegExp(`/api/v1/scenes/${s1}$`), () => {
    /* never answered: a save stuck on a slow connection */
  });
  const box = narration(page, 1);
  await box.click();
  await box.pressSequentially(' x');
  await box.blur();
  expect(await closeAndSeeIfAsked(page)).toBe('dialog');
});

test('after a save fails, closing the tab still asks (the text is not on the server)', async ({page}) => {
  const project = await openDraft(page);
  const s1 = await sceneId(page, project.id, 1);
  await page.route(new RegExp(`/api/v1/scenes/${s1}$`), (route) =>
    route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({error: {code: 'internal_error', message: 'Something failed on our side.'}})}),
  );
  const box = narration(page, 1);
  await box.click();
  await box.pressSequentially(' lost?');
  await box.blur();
  await expect(sceneCard(page, 1).getByRole('alert')).toHaveText('Something failed on our side.');
  await expect(box).toHaveValue(/ lost\?$/);
  expect(await closeAndSeeIfAsked(page)).toBe('dialog');
});

// A failing B8 job ends in about 0.1 s on this stack, so the screen rarely sees the project
// "scripting". The project fetch is held until the failure is recorded, which makes that case
// certain (an unheld version of this test failed in 5 of 6 runs, BUG-054).
test('a failed whole-script rewrite says why and keeps the scenes, even when it failed before the next project fetch', async ({page}) => {
  const project = await openDraft(page);
  const before = await narrations(page);
  let armed = false;
  await page.route(new RegExp(`/api/v1/projects/${project.id}$`), async (route) => {
    if (armed && route.request().method() === 'GET') {
      await expect
        .poll(async () => {
          const jobs = (await call(page, 'GET', `/projects/${project.id}/jobs`)).body.items as {type: string; state: string}[];
          return jobs.some((j) => j.type === 'script' && j.state === 'failed');
        })
        .toBe(true);
    }
    await route.continue();
  });
  await page.getByRole('button', {name: 'Rewrite whole script'}).click();
  await page.getByRole('textbox', {name: 'What should change'}).fill(`more drama ${MOCK_FAIL}`);
  armed = true;
  await page.getByRole('button', {name: 'Write a new script'}).click();
  await expect(page.getByText(/A new script couldn't be written: The AI service didn't answer properly\. Please try again\. Your scenes are unchanged/)).toBeVisible();
  expect(await savedNarrations(page, project.id)).toEqual(before);
});

test('Shorten with AI appears over the target and writes a shorter script (B8)', async ({page}) => {
  await newCreator(page);
  const project = await draftProject(page, 'Morning walks', {targetSeconds: 15});
  // The mock script is about 12 s; one long scene takes it past 115% of 15 s.
  const long = Array.from({length: 20}, (_, i) => `word${i}`).join(' ');
  expect((await call(page, 'POST', `/projects/${project.id}/scenes`, {narration: long})).status).toBe(201);
  const {balance, costs} = await credits(page);
  await page.goto(`/app/p/${project.id}/script`);
  await expect(narration(page, 5)).toHaveValue(long);

  const shorten = summary(page).getByRole('button', {name: `Shorten with AI · ${costs.script} credit${costs.script === 1 ? '' : 's'}`});
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/script/regenerate'));
  await shorten.click();
  expect(JSON.parse((await sent).postData() ?? '{}').instructions).toMatch(/15 seconds/);
  await expect(page.getByRole('textbox', {name: /^Scene \d+ narration$/})).toHaveCount(4);
  await expect(shorten).toBeHidden();
  await expect.poll(async () => (await credits(page)).balance).toBe(balance - costs.script);
  expect((await getProject(page, project.id)).estimatedSeconds).toBeLessThanOrEqual(15 * 1.15);
});

test('the scene menu closes on a second press of its button', async ({page}) => {
  await openDraft(page);
  const button = sceneCard(page, 2).getByRole('button', {name: 'More actions for scene 2'});
  await button.click();
  await expect(page.getByRole('menu', {name: 'Scene 2 actions'})).toBeVisible();
  await button.click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('with one scene, the menu opens on Duplicate and Escape returns to its button', async ({page}) => {
  const project = await openDraft(page);
  // Down to one scene.
  for (const s of (await getProject(page, project.id)).scenes.filter((x) => x.position > 1)) {
    expect((await call(page, 'DELETE', `/scenes/${s.id}`)).status).toBe(204);
  }
  await page.reload();
  await expect(page.getByRole('textbox', {name: /^Scene \d+ narration$/})).toHaveCount(1);
  await sceneCard(page, 1).getByRole('button', {name: 'More actions for scene 1'}).click();
  await expect(page.getByRole('menuitem', {name: 'Duplicate'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(sceneCard(page, 1).getByRole('button', {name: 'More actions for scene 1'})).toBeFocused();
});

test.describe('phone width (375 px)', () => {
  test.use({viewport: {width: 375, height: 812}});

  test('the New Reel screen and the scene cards fit the width', async ({page}) => {
    const project = await openDraft(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (let n = 1; n <= project.scenes.length; n++) {
      const card = (await sceneCard(page, n).boundingBox())!;
      expect(card.x + card.width, `scene ${n} card`).toBeLessThanOrEqual(375);
      await sceneCard(page, n).scrollIntoViewIfNeeded();
      const more = (await sceneCard(page, n).getByRole('button', {name: `More actions for scene ${n}`}).boundingBox())!;
      expect(more.x + more.width, `scene ${n} menu button`).toBeLessThanOrEqual(375);
      const onScreen = (await sceneCard(page, n).getByRole('textbox', {name: `Scene ${n} on-screen text`}).boundingBox())!;
      expect(onScreen.x + onScreen.width, `scene ${n} on-screen text`).toBeLessThanOrEqual(375);
    }
    await page.goto('/app/new');
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Craft your next Reel');
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------- round 3 (FIX_LOG_F5, Round 3)

test('a save that keeps failing stops Generate with "Some changes aren’t saved yet…"; once it saves, Generate goes ahead', async ({page}) => {
  const project = await openDraft(page);
  const s1 = await sceneId(page, project.id, 1);
  const failing = new RegExp(`/api/v1/scenes/${s1}$`);
  await page.route(failing, (route) =>
    route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({error: {code: 'internal_error', message: 'Something failed on our side.'}})}),
  );
  const box = narration(page, 1);
  await box.click();
  await box.press('End');
  await box.pressSequentially(' Saved at last.');
  await box.blur();
  await expect(sceneCard(page, 1).getByRole('alert')).toHaveText('Something failed on our side.');
  await expect(sceneCard(page, 1).getByText('Saved', {exact: true})).toBeHidden();

  const generateCalls: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/generate') && generateCalls.push(r.url()));
  await summary(page).getByRole('button', {name: 'Generate Reel'}).click();
  await expect(summary(page).getByText('Some changes aren’t saved yet: Something failed on our side.')).toBeVisible();
  expect(generateCalls).toHaveLength(0);
  await expect(page).toHaveURL(/\/script$/);

  await page.unroute(failing);
  await summary(page).getByRole('button', {name: 'Generate Reel'}).click();
  await expect(page).toHaveURL(new RegExp(`/app/p/${project.id}/edit$`));
  expect(generateCalls).toHaveLength(1);
  const saved = (await getProject(page, project.id)).scenes.find((s) => s.id === s1)!;
  expect(saved.narration.endsWith(' Saved at last.')).toBe(true);
});

test('a double click on Generate while text is still being saved starts it once', async ({page}) => {
  const project = await openDraft(page);
  const generateCalls: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/generate') && generateCalls.push(r.url()));
  const box = narration(page, 2);
  await box.click();
  await box.press('End');
  await box.pressSequentially(' Twice?');
  await summary(page).getByRole('button', {name: 'Generate Reel'}).dblclick();
  await expect(page).toHaveURL(new RegExp(`/app/p/${project.id}/edit$`));
  expect(generateCalls).toHaveLength(1);
});

test.describe('New Reel at phone width (375 px)', () => {
  test.use({viewport: {width: 375, height: 812}});

  test('every part of New Reel fits the width, with ideas shown', async ({page}) => {
    await newCreator(page, {niche: 'Fitness'});
    await page.goto('/app/new');
    await page.getByRole('button', {name: 'Get ideas'}).click();
    await expect(page.getByRole('region', {name: 'Ideas'}).getByRole('article')).toHaveCount(5);
    const widest = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main button, main input, main textarea, main select, main section, main article, main fieldset'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {right: Math.round(r.right), what: `${el.tagName} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`};
        })
        .filter((x) => x.right > 375),
    );
    expect(widest).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

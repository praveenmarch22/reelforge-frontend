import {expect, test} from '@playwright/test';
import {
  answered,
  call,
  chooseOption,
  credits,
  getProject,
  holdProjectFetches,
  MOCK_FAIL,
  narration,
  narrations,
  newCreator,
  setBalance,
  voices,
} from './helpers';

// New Reel (docs/SCREENS_F5_F6.md section 1) against the real backend with mock AI providers.

const box = (page: import('@playwright/test').Page) => page.getByRole('textbox', {name: /what is your reel about|your script/i});
const chip = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', {name, exact: true});

test('from the dashboard to a written script: topic, mode, length, tone, voice and the cost', async ({page}) => {
  await newCreator(page);
  const {costs, balance} = await credits(page);
  const laura = (await voices(page)).find((v) => v.name === 'Laura')!;

  await page.goto('/app');
  await page.getByRole('textbox', {name: "What's your next Reel about?"}).fill('Cold showers');
  await chip(page, 'Full AI').click();
  await chip(page, '60s').click();
  await page.getByRole('button', {name: 'Create', exact: true}).click();

  await expect(page).toHaveURL(/\/app\/new\?/);
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toEqual({mode: 'full_ai', length: '60', topic: 'Cold showers'});
  await expect(box(page)).toHaveValue('Cold showers');
  await expect(chip(page, 'Full AI')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '60s')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(`${costs.script} credit${costs.script === 1 ? '' : 's'}`, {exact: true})).toBeVisible();
  await expect(page.getByText(`${balance} remaining`)).toBeVisible();

  await chip(page, 'Funny').click();
  await chooseOption(page.getByRole('combobox', {name: 'Narrator'}), /^Laura/);

  const held = await holdProjectFetches(page);
  const created = answered(page, 'POST', /\/api\/v1\/projects$/);
  await page.getByRole('button', {name: 'Write script'}).click();
  expect((await created).status()).toBe(202);
  await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]{36}\/script$/);
  await expect(page.getByText('Writing your script…')).toBeVisible();
  await held.release();

  await expect(narration(page, 1)).toHaveValue(/Cold showers/);
  expect(await narrations(page)).toHaveLength(4);
  await expect(page.getByText('Writing your script…')).toBeHidden();

  const id = projectIdFromUrl(page.url());
  const saved = await getProject(page, id);
  expect({tone: saved.tone, mode: saved.mode, targetSeconds: saved.targetSeconds, voiceId: saved.voiceId}).toEqual({
    tone: 'funny', mode: 'full_ai', targetSeconds: 60, voiceId: laura.id,
  });
  expect((await credits(page)).balance).toBe(balance - costs.script);
});

// The dashboard's Ideas button opens /app/new?ideas=1, which asks for ideas at once.
test('ideas from the dashboard: asked for at once (ideas=1)', async ({page}) => {
  await newCreator(page, {niche: 'Fitness'});
  await page.goto('/app');
  const asked = answered(page, 'POST', /\/api\/v1\/ideas$/);
  await page.getByRole('button', {name: 'Ideas', exact: true}).click();
  await expect(page).toHaveURL(/ideas=1/);
  expect((await asked).status()).toBe(202);
  await expect(page.getByRole('region', {name: 'Ideas'}).getByRole('article')).toHaveCount(5);
  await expect(page.getByText('Thinking of ideas…')).toBeHidden();
});

test('Get ideas (B1, polled with G1), and "Use this" becomes the topic of the script', async ({page}) => {
  await newCreator(page, {niche: 'Fitness'});
  await page.goto('/app/new');
  await page.getByRole('button', {name: 'Get ideas'}).click();
  const ideas = page.getByRole('region', {name: 'Ideas'});
  await expect(ideas.getByRole('article')).toHaveCount(5);
  const third = ideas.getByRole('article').filter({hasText: 'Fitness idea 3'});
  await expect(third).toContainText('The one Fitness mistake almost everyone makes, number 3.');
  await third.getByRole('button', {name: /use this/i}).click();
  await expect(box(page)).toHaveValue('Fitness idea 3');

  await page.getByRole('button', {name: 'Write script'}).click();
  await expect(page.getByRole('textbox', {name: 'Title'})).toHaveValue('Fitness idea 3');
});

test('a pasted script keeps the creator’s words, a paragraph per scene', async ({page}) => {
  await newCreator(page);
  await page.goto('/app/new');
  await page.getByRole('checkbox', {name: 'Paste my own script'}).check();
  await expect(box(page)).toHaveAttribute('maxlength', '5000');
  const paragraphs = ['Nobody tells you this about sleep.', 'Your phone is the problem, not your pillow.'];
  await box(page).fill(paragraphs.join('\n\n'));
  await page.getByRole('button', {name: 'Write script'}).click();
  await expect(narration(page, 2)).toHaveValue(paragraphs[1]);
  expect(await narrations(page)).toEqual(paragraphs);
});

test('limits and refusals: 300 characters, an empty topic, and 402 with no credits', async ({page}) => {
  const me = await newCreator(page);
  await page.goto('/app/new');
  await box(page).fill('x'.repeat(320));
  await expect(box(page)).toHaveValue('x'.repeat(300));
  await expect(page.getByText('300 / 300')).toBeVisible();

  await box(page).fill('');
  await page.getByRole('button', {name: 'Write script'}).click();
  await expect(page.getByText('Write what your Reel is about')).toBeVisible();

  // Line breaks in a topic become spaces.
  await box(page).fill('Two\nlines');
  await expect(box(page)).toHaveValue('Two lines');

  setBalance(me.id, 0);
  await page.reload();
  await box(page).fill('Something worth a Reel');
  const created = answered(page, 'POST', /\/api\/v1\/projects$/);
  await page.getByRole('button', {name: 'Write script'}).click();
  expect((await created).status()).toBe(402);
  await expect(page.getByText(/^This needs 1 credit and you have 0\. Your credits renew on .+\.$/)).toBeVisible();
  await expect(page).toHaveURL(/\/app\/new$/);
  expect((await call(page, 'GET', '/projects')).body.items).toHaveLength(0);
});

test('a script that fails is refunded, says so, and Try again writes it again (B8)', async ({page}) => {
  await newCreator(page);
  const {balance} = await credits(page);
  await page.goto('/app/new');
  await box(page).fill(`Bad luck ${MOCK_FAIL}`);
  await page.getByRole('button', {name: 'Write script'}).click();
  // The reason comes from the failed script job (G2).
  const notice = page.getByText(/The script couldn't be written: The AI service didn't answer properly\. Please try again\. Your credit was refunded\./);
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await credits(page)).balance).toBe(balance);

  const retried = answered(page, 'POST', /\/script\/regenerate$/);
  await page.getByRole('button', {name: 'Try again'}).click();
  expect((await retried).status()).toBe(202);
  // The mock model fails again on the same topic: a second failed script job, the notice comes
  // back, and nothing is charged.
  const id = projectIdFromUrl(page.url());
  await expect
    .poll(async () => (await call(page, 'GET', `/projects/${id}/jobs`)).body.items.filter((j: {state: string}) => j.state === 'failed').length)
    .toBe(2);
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await credits(page)).balance).toBe(balance);

  // "change the topic" goes back to New Reel with the topic, mode and length filled in.
  await page.getByRole('link', {name: 'change the topic'}).click();
  await expect(page).toHaveURL(/\/app\/new\?/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({topic: `Bad luck ${MOCK_FAIL}`, mode: 'faceless', length: '30'});
  await expect(box(page)).toHaveValue(`Bad luck ${MOCK_FAIL}`);
});

test('an unknown mode in the address is ignored, and the script is written', async ({page}) => {
  await newCreator(page);
  await page.goto('/app/new?topic=Tea%20rituals&mode=banana');
  await expect(chip(page, 'Faceless')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Full AI')).toHaveAttribute('aria-pressed', 'false');
  const created = answered(page, 'POST', /\/api\/v1\/projects$/);
  await page.getByRole('button', {name: 'Write script'}).click();
  expect((await created).status()).toBe(202);
  await expect(page.getByRole('textbox', {name: 'Title'})).toHaveValue('Tea rituals');
});

function projectIdFromUrl(url: string): string {
  const id = new URL(url).pathname.match(/\/app\/p\/([0-9a-f-]{36})\//)?.[1];
  if (!id) throw new Error(`no project id in ${url}`);
  return id;
}

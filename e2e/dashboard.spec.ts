import {expect, test, type Page} from '@playwright/test';
import {DEMO_REELS, h1, loginAsDemo, reelCard, signUp} from './helpers';

// PRD 5.9 (D1, D5), flow 1 step 5, flow 8; API_DESIGN.md B2 (counts, polling every 2 s).

const topicInput = (page: Page) => page.getByRole('textbox', {name: "What's your next Reel about?"});
const chip = (page: Page, name: string) =>
  page.getByRole('region', {name: 'Start a new Reel'}).getByRole('button', {name, exact: true});

/** The starter-idea buttons of the empty dashboard (everything in that section except "Create your first Reel"). */
const starterIdeas = (page: Page) =>
  page
    .getByRole('region', {name: 'Getting started'})
    .getByRole('button')
    .filter({hasNotText: /create your first reel/i});

/** Waits for the New Reel screen and returns its query string. */
async function newReelParams(page: Page): Promise<Record<string, string>> {
  await expect(page).toHaveURL(/\/app\/new\?/);
  // F5 built the screen; its heading is "Craft your next Reel" (docs/SCREENS_F5_F6.md section 1).
  await expect(h1(page)).toHaveText('Craft your next Reel');
  return Object.fromEntries(new URL(page.url()).searchParams);
}

test.describe('dashboard for a new account', () => {
  test.beforeEach(async ({page}) => {
    await signUp(page);
    await page.goto('/app');
    await expect(h1(page)).toHaveText('Welcome, Asha');
  });

  test('shows the welcome, the empty state and starter ideas, and no stats tiles', async ({page}) => {
    const gettingStarted = page.getByRole('region', {name: 'Getting started'});
    await expect(gettingStarted.getByText('Your Reels will appear here')).toBeVisible();
    // "Create your first Reel" and three starter ideas.
    await expect(gettingStarted.getByRole('button', {name: 'Create your first Reel'})).toBeVisible();
    await expect(starterIdeas(page)).toHaveCount(3);

    await expect(page.getByRole('region', {name: 'Summary'})).toHaveCount(0);
    await expect(page.getByText('Reels made')).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'Recent Reels'})).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);

    // A new account starts with the monthly allowance and no channel (no channel pill; F7).
    await expect(page.getByRole('link', {name: '100 of 100 credits left'})).toBeVisible();
    await expect(page.locator('a[href="/app/settings?tab=youtube"]')).toHaveCount(0);
    await expect(page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Admin'})).toHaveCount(0);
  });

  test('a starter idea opens the New Reel screen with that idea as the topic', async ({page}) => {
    const idea = starterIdeas(page).first();
    const text = (await idea.textContent())!.trim();
    expect(text).not.toBe('');

    await idea.click();

    expect(await newReelParams(page)).toEqual({topic: text, mode: 'faceless', length: '30'});
  });

  test('a starter idea carries the chosen mode and length', async ({page}) => {
    await chip(page, 'Full AI').click();
    await chip(page, '15s').click();
    const idea = starterIdeas(page).last();
    const text = (await idea.textContent())!.trim();

    await idea.click();

    expect(await newReelParams(page)).toEqual({topic: text, mode: 'full_ai', length: '15'});
  });

  // PRD flow 1 step 5: "Lands on the empty dashboard with a Create your first Reel button."
  test('has a "Create your first Reel" button that opens the New Reel screen with no topic (PRD flow 1)', async ({page}) => {
    await expect(page.getByText('Your Reels will appear here')).toBeVisible();
    await chip(page, '60s').click();

    await page.getByRole('button', {name: /create your first reel/i}).click();

    expect(await newReelParams(page)).toEqual({mode: 'faceless', length: '60'});
  });
});

test.describe('dashboard for the demo account', () => {
  test.beforeEach(async ({page}) => {
    await loginAsDemo(page);
  });

  test('shows the stats tiles, the credits and YouTube channel pills, and the admin link', async ({page}) => {
    const summary = page.getByRole('region', {name: 'Summary'});
    await expect(summary).toContainText(/Reels made\s*7/);
    await expect(summary).toContainText(/Posted\s*2/);
    await expect(summary).toContainText(/Credits reset in\s*19 days/);
    await expect(summary).toContainText('86 of 100 left');

    await expect(page.getByRole('link', {name: '86 of 100 credits left'})).toHaveText('86 credits');
    await expect(page.getByRole('link', {name: /Demo Shorts/})).toBeVisible();
    await expect(page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Admin'})).toBeVisible();
    await expect(page.getByText('Your Reels will appear here')).toHaveCount(0);
  });

  test('shows the five most recent Reels with their status, mode and length', async ({page}) => {
    const recent = page.getByRole('region', {name: 'Recent Reels'});
    await expect(recent.getByRole('article')).toHaveCount(5);

    const expected: [string, string][] = [
      [DEMO_REELS.generating[0], 'Generating'],
      [DEMO_REELS.failed[0], 'Failed'],
      [DEMO_REELS.ready[0], 'Ready'],
      [DEMO_REELS.posted[0], 'Posted'],
      [DEMO_REELS.rendered[0], 'Rendered'],
    ];
    for (const [title, status] of expected) {
      await expect(reelCard(page, title).getByText(status, {exact: true}), title).toBeVisible();
    }
    // Newest first.
    await expect(recent.getByRole('article').getByRole('heading')).toHaveText(expected.map(([title]) => title));

    await expect(reelCard(page, DEMO_REELS.generating[0]).getByText('Full AI')).toBeVisible();
    await expect(reelCard(page, DEMO_REELS.ready[0]).getByText('Faceless')).toBeVisible();
    await expect(reelCard(page, DEMO_REELS.ready[0]).getByText('0:45')).toBeVisible();

    // Deleting is done from the library, not from here.
    await expect(recent.getByRole('button', {name: /more options/i})).toHaveCount(0);
  });

  // PRD flow 8: script step for a draft, editor for a generated Reel, result screen for a rendered or posted one.
  test('each recent Reel opens at the step that matches its status', async ({page}) => {
    const expected: [string, RegExp][] = [
      [DEMO_REELS.generating[0], /\/app\/p\/[\w-]+\/edit$/],
      [DEMO_REELS.ready[0], /\/app\/p\/[\w-]+\/edit$/],
      [DEMO_REELS.failed[0], /\/app\/p\/[\w-]+\/edit$/],
      [DEMO_REELS.rendered[0], /\/app\/p\/[\w-]+\/publish$/],
      [DEMO_REELS.posted[0], /\/app\/p\/[\w-]+\/publish$/],
    ];
    for (const [title, href] of expected) {
      await expect(page.getByRole('link', {name: `Open ${title}`}), title).toHaveAttribute('href', href);
    }

    await page.getByRole('link', {name: `Open ${DEMO_REELS.posted[0]}`}).click();
    await expect(page).toHaveURL(/\/publish$/);
    // F7 built the publish screen; it runs on the real backend (the mock API has no project details).
  });

  test('"View all" opens the library', async ({page}) => {
    await page.getByRole('link', {name: 'View all'}).click();

    await expect(page).toHaveURL(/\/app\/projects$/);
    await expect(h1(page)).toHaveText('Your Reels');
  });

  test('a generating Reel shows live progress and becomes Ready without a reload', async ({page}) => {
    // The mock adds 3% per poll and the app polls every 2 s, so this takes about half a minute.
    test.setTimeout(150_000);
    const card = reelCard(page, DEMO_REELS.generating[0]);
    const bar = card.getByRole('progressbar');
    const percent = async () => Number(await bar.getAttribute('aria-valuenow'));

    await expect(card.getByText('Generating', {exact: true})).toBeVisible();
    // Value and label are read in one go: the bar moves every 2 s.
    const first = await bar.evaluate((el) => ({
      value: Number(el.getAttribute('aria-valuenow')),
      label: el.getAttribute('aria-label'),
    }));
    const start = first.value;
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(100);
    expect(first.label).toBe(`Generating ${start}%`);

    await expect.poll(percent, {timeout: 20_000, message: 'progress should advance while polling'}).toBeGreaterThan(start);

    await expect(card.getByText('Ready', {exact: true})).toBeVisible({timeout: 120_000});
    await expect(card.getByText('Generating', {exact: true})).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    // It now has a length.
    await expect(card.getByText(/^\d:\d\d$/)).toBeVisible();
    // The other cards and the tiles are untouched.
    await expect(page.getByRole('region', {name: 'Summary'})).toContainText(/Reels made\s*7/);
  });
});

test.describe('prompt on the dashboard', () => {
  test.beforeEach(async ({page}) => {
    await loginAsDemo(page);
  });

  test('Create opens the New Reel screen with the topic and the default mode and length', async ({page}) => {
    await expect(chip(page, 'Faceless')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, '30s')).toHaveAttribute('aria-pressed', 'true');

    await topicInput(page).fill('  5 desk stretches & why they work?  ');
    await page.getByRole('button', {name: 'Create'}).click();

    expect(await newReelParams(page)).toEqual({topic: '5 desk stretches & why they work?', mode: 'faceless', length: '30'});
  });

  test('pressing Enter in the prompt does the same as Create', async ({page}) => {
    await topicInput(page).fill('Cold showers');
    await topicInput(page).press('Enter');

    expect(await newReelParams(page)).toEqual({topic: 'Cold showers', mode: 'faceless', length: '30'});
  });

  test('the mode and length chips are carried into the query string', async ({page}) => {
    await chip(page, 'Full AI').click();
    await chip(page, '60s').click();
    await expect(chip(page, 'Full AI')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'Faceless')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(page, '60s')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, '30s')).toHaveAttribute('aria-pressed', 'false');

    await topicInput(page).fill('Tokyo at night');
    await page.getByRole('button', {name: 'Create'}).click();

    expect(await newReelParams(page)).toEqual({topic: 'Tokyo at night', mode: 'full_ai', length: '60'});
  });

  for (const seconds of ['15', '30', '60', '90']) {
    test(`the ${seconds}s chip sets length=${seconds}`, async ({page}) => {
      await chip(page, `${seconds}s`).click();
      await topicInput(page).fill('Any topic');
      await page.getByRole('button', {name: 'Create'}).click();

      expect((await newReelParams(page)).length).toBe(seconds);
    });
  }

  test('Ideas opens the New Reel screen asking for ideas, with the chosen mode and length', async ({page}) => {
    await chip(page, 'Full AI').click();
    await chip(page, '90s').click();
    await page.getByRole('button', {name: 'Ideas'}).click();

    expect(await newReelParams(page)).toEqual({ideas: '1', mode: 'full_ai', length: '90'});
  });
});

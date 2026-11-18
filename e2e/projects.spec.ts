import {expect, test, type Page} from '@playwright/test';
import {
  ALL_DEMO_REELS,
  askToDelete,
  deleteDialog,
  DEMO_REELS,
  expectReels,
  h1,
  loginAsDemo,
  openProjects,
  reelCard,
  signUp,
} from './helpers';

// PRD 5.9 (D1 list, D2 filter and search, D4 delete); API_DESIGN.md B2, B6.

const filter = (page: Page, name: string) =>
  page.getByRole('group', {name: 'Filter by status'}).getByRole('button', {name, exact: true});
const search = (page: Page) => page.getByRole('searchbox', {name: 'Search Reels'});

test.describe('projects library', () => {
  test.beforeEach(async ({page}) => {
    await loginAsDemo(page);
    await openProjects(page);
  });

  test('shows every Reel of the account with its status', async ({page}) => {
    await expect(page).toHaveURL(/\/app\/projects$/);
    await expectReels(page, ALL_DEMO_REELS);
    await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');

    const statuses: [string, string][] = [
      [DEMO_REELS.posted[0], 'Posted'],
      [DEMO_REELS.posted[1], 'Posted'],
      [DEMO_REELS.ready[0], 'Ready'],
      [DEMO_REELS.generating[0], 'Generating'],
      [DEMO_REELS.draft[0], 'Draft'],
      [DEMO_REELS.failed[0], 'Failed'],
      [DEMO_REELS.rendered[0], 'Rendered'],
    ];
    for (const [title, status] of statuses) {
      await expect(reelCard(page, title).getByText(status, {exact: true}), title).toBeVisible();
    }
    // A draft opens at the script step (PRD flow 8).
    await expect(page.getByRole('link', {name: `Open ${DEMO_REELS.draft[0]}`})).toHaveAttribute('href', /\/script$/);
  });

  const FILTERS: [string, string[]][] = [
    ['Drafts', DEMO_REELS.draft],
    ['In progress', DEMO_REELS.generating],
    ['Ready', [...DEMO_REELS.ready, ...DEMO_REELS.rendered]],
    ['Posted', DEMO_REELS.posted],
    ['Failed', DEMO_REELS.failed],
  ];
  for (const [name, titles] of FILTERS) {
    test(`the "${name}" filter shows only those Reels, and "All" brings the rest back`, async ({page}) => {
      await expectReels(page, ALL_DEMO_REELS);

      await filter(page, name).click();

      await expect(filter(page, name)).toHaveAttribute('aria-pressed', 'true');
      await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'false');
      await expectReels(page, titles);

      await filter(page, 'All').click();
      await expectReels(page, ALL_DEMO_REELS);
    });
  }

  test('search finds Reels by title, ignoring case', async ({page}) => {
    await search(page).fill('TOKYO');
    await expectReels(page, DEMO_REELS.failed);

    await search(page).fill('');
    await expectReels(page, ALL_DEMO_REELS);
  });

  test('search and a status filter work together', async ({page}) => {
    await filter(page, 'Posted').click();
    await expectReels(page, DEMO_REELS.posted);

    await search(page).fill('rule');
    await expectReels(page, [DEMO_REELS.posted[1]]);
  });

  test('a search with no match says so, and "Clear filters" restores the full list', async ({page}) => {
    await filter(page, 'Posted').click();
    await search(page).fill('no reel is called this');

    await expect(page.getByText('No Reels match')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);

    await page.getByRole('button', {name: 'Clear filters'}).click();

    await expect(search(page)).toHaveValue('');
    await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');
    await expectReels(page, ALL_DEMO_REELS);
  });

  test('cancelling the delete confirmation keeps the Reel', async ({page}) => {
    const title = DEMO_REELS.draft[0];
    await askToDelete(page, title);

    await deleteDialog(page).getByRole('button', {name: 'Cancel'}).click();

    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, ALL_DEMO_REELS);

    // Escape cancels too.
    await askToDelete(page, title);
    await page.keyboard.press('Escape');
    await expect(deleteDialog(page)).toBeHidden();

    await page.reload();
    await expectReels(page, ALL_DEMO_REELS);
  });

  test('confirming the delete removes the Reel, and it stays gone after a reload', async ({page}) => {
    const title = DEMO_REELS.draft[0];
    const rest = ALL_DEMO_REELS.filter((t) => t !== title);
    await askToDelete(page, title);

    await deleteDialog(page).getByRole('button', {name: 'Delete'}).click();

    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, rest);

    await page.reload();
    await expect(h1(page)).toHaveText('Your Reels');
    await expectReels(page, rest);

    // The dashboard count follows.
    await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Home'}).click();
    await expect(page.getByRole('region', {name: 'Summary'})).toContainText(/Reels made\s*6/);
  });

  test('deleting while a filter is on removes the Reel from that view', async ({page}) => {
    await filter(page, 'Posted').click();
    await expectReels(page, DEMO_REELS.posted);

    await askToDelete(page, DEMO_REELS.posted[0]);
    await deleteDialog(page).getByRole('button', {name: 'Delete'}).click();

    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, [DEMO_REELS.posted[1]]);
  });

  test('the options menu can be reached and used with the keyboard', async ({page}) => {
    const title = DEMO_REELS.draft[0];
    const options = page.getByRole('button', {name: `More options for ${title}`});

    await options.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', {name: 'Delete'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('"New Reel" opens the New Reel screen', async ({page}) => {
    await page.getByRole('link', {name: 'New Reel'}).first().click();

    await expect(page).toHaveURL(/\/app\/new$/);
    await expect(h1(page)).toHaveText('New Reel');
  });
});

test('the library of a new account is empty and points to creating a Reel', async ({page}) => {
  await signUp(page);
  await page.goto('/app/projects');

  await expect(h1(page)).toHaveText('Your Reels');
  await expect(page.getByText('No Reels yet')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Clear filters'})).toHaveCount(0);
});

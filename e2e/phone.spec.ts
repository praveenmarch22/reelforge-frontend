import {expect, test} from '@playwright/test';
import {
  ALL_DEMO_REELS,
  deleteDialog,
  DEMO_REELS,
  expectReels,
  fitsViewportWidth,
  h1,
  loginAsDemo,
  logOut,
  openProjects,
  signUp,
} from './helpers';

// Phone-width regression tests for QA-022, QA-023 and QA-019 (PRD section 12: the web app works in a phone browser).

const PHONE = {width: 390, height: 844};

test.describe('phone width (390x844)', () => {
  test.use({viewport: PHONE});

  test('QA-022: the dashboard prompt is wide enough to use and Create stays inside its box', async ({page}) => {
    await loginAsDemo(page);
    const region = page.getByRole('region', {name: 'Start a new Reel'});
    const input = page.getByRole('textbox', {name: "What's your next Reel about?"});
    const create = page.getByRole('button', {name: 'Create'});

    const regionBox = (await region.boundingBox())!;
    const inputBox = (await input.boundingBox())!;
    const createBox = (await create.boundingBox())!;
    expect(inputBox.width, 'prompt input width').toBeGreaterThanOrEqual(200);
    expect(createBox.x, 'Create starts inside the box').toBeGreaterThanOrEqual(regionBox.x);
    expect(createBox.x + createBox.width, 'Create ends inside the box').toBeLessThanOrEqual(regionBox.x + regionBox.width);
    expect(await fitsViewportWidth(page), 'no sideways scrolling').toBe(true);

    await input.fill('Phone idea');
    await expect(input).toHaveValue('Phone idea');
    await create.click();
    await expect(page).toHaveURL(/\/app\/new\?/);
    expect(new URL(page.url()).searchParams.get('topic')).toBe('Phone idea');
  });

  test('QA-019: an 80-character name does not push the page header off the screen', async ({page}) => {
    await signUp(page, {name: 'A'.repeat(80), email: 'long.name@example.com', password: 'Long-name-pass-1'});
    await page.goto('/app');
    await expect(h1(page)).toContainText('Welcome, AAAA');

    const title = (await h1(page).boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(PHONE.width);
    expect(await fitsViewportWidth(page), 'no sideways scrolling').toBe(true);
    await expect(page.getByRole('link', {name: '100 of 100 credits left'})).toBeInViewport();
  });

  test('QA-002: Log out can be clicked on the dashboard and in the library', async ({page}) => {
    await loginAsDemo(page);
    await expect(page.getByRole('region', {name: 'Recent Reels'}).getByRole('article')).toHaveCount(5);
    await page.getByRole('button', {name: 'Account menu'}).click();
    // trial: checks that a click would land on the item, without clicking yet.
    await page.getByRole('menuitem', {name: 'Log out'}).click({trial: true, timeout: 10_000});
    await page.keyboard.press('Escape');

    await openProjects(page);
    await expectReels(page, ALL_DEMO_REELS);
    await logOut(page);
    await expect(h1(page)).toHaveText('Welcome back');
  });
});

test.describe('touch screen at phone width', () => {
  test.use({viewport: PHONE, hasTouch: true, isMobile: true});

  test('QA-023: the options button on each card is visible without hovering, and deleting works by touch', async ({page}) => {
    await loginAsDemo(page);
    await openProjects(page);
    await expectReels(page, ALL_DEMO_REELS);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches), 'the browser reports a touch-only device').toBe(true);

    for (const title of ALL_DEMO_REELS) {
      const options = page.getByRole('button', {name: `More options for ${title}`});
      await expect(options, title).toHaveCSS('opacity', '1');
    }

    const title = DEMO_REELS.draft[0];
    await page.getByRole('button', {name: `More options for ${title}`}).tap();
    await page.getByRole('menuitem', {name: 'Delete'}).tap();
    await expect(deleteDialog(page)).toBeVisible();
    await deleteDialog(page).getByRole('button', {name: 'Delete'}).tap();

    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, ALL_DEMO_REELS.filter((t) => t !== title));
  });
});

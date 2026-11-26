import {expect, test} from '@playwright/test';
import {
  controlsWithoutAName,
  nestedInteractiveControls,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  emailField,
  h1,
  loginAsDemo,
  openProjects,
  passwordField,
  tabTo,
} from './helpers';

test.describe('unknown URLs', () => {
  test('an unknown URL shows the 404 page', async ({page}) => {
    await page.goto('/definitely-not-a-page');

    await expect(h1(page)).toHaveText('Page not found');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText("We couldn't find that page.")).toBeVisible();

    // Signed out, "Back to home" ends at the login page.
    await page.getByRole('link', {name: 'Back to home'}).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown URL under /app shows the 404 page and leads a signed-in user home', async ({page}) => {
    await loginAsDemo(page);
    await page.goto('/app/no-such-screen');

    await expect(page.getByText("We couldn't find that page.")).toBeVisible();
    await page.getByRole('link', {name: 'Back to home'}).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });
});

test.describe('screens that are not built yet', () => {
  // Every designed screen has a route and shows the placeholder inside the app shell, not the 404 page.
  for (const [path, title] of [
    ['/app/p/some-id/edit', 'Reel editor'],
    ['/app/p/some-id/render', 'Render'],
    ['/app/p/some-id/publish', 'Publish'],
    ['/app/settings', 'Settings'],
    // /onboarding was in this list until F4 built it; it is covered by onboarding*.spec.ts.
    // /app/new and /app/p/:id/script were here until F5 built them; see e2e-real/ and src/features/create.
  ]) {
    test(`${path} shows the "${title}" placeholder`, async ({page}) => {
      await loginAsDemo(page);
      await page.goto(path);

      await expect(h1(page)).toHaveText(title);
      await expect(page.getByText("This screen isn't built yet")).toBeVisible();
      await expect(page.getByRole('navigation', {name: 'Main'})).toBeVisible();

      await page.getByRole('link', {name: 'Back to home'}).click();
      await expect(page).toHaveURL(/\/app$/);
    });
  }
});

test.describe('navigation', () => {
  test('the sidebar opens each section and marks the current one', async ({page}) => {
    await loginAsDemo(page);
    const nav = page.getByRole('navigation', {name: 'Main'});
    await expect(nav.getByRole('link', {name: 'Home'})).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', {name: 'Projects'}).click();
    await expect(page).toHaveURL(/\/app\/projects$/);
    await expect(nav.getByRole('link', {name: 'Projects'})).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', {name: 'Home'})).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', {name: 'Settings'}).click();
    await expect(h1(page)).toHaveText('Settings');

    await nav.getByRole('link', {name: 'Home'}).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('the credits and Instagram pills open their settings tabs', async ({page}) => {
    await loginAsDemo(page);

    await page.getByRole('link', {name: '86 of 100 credits left'}).click();
    await expect(page).toHaveURL(/\/app\/settings\?tab=credits$/);

    await page.getByRole('link', {name: /@praveen_fit/}).click();
    await expect(page).toHaveURL(/\/app\/settings\?tab=instagram$/);
  });
});

test.describe('accessibility basics', () => {
  test('login page: one h1 and every control has an accessible name', async ({page}) => {
    await page.goto('/login');
    await expect(h1(page)).toHaveCount(1);
    await expect(h1(page)).toHaveText('Welcome back');

    expect(await controlsWithoutAName(page)).toEqual([]);
    await expect(page.getByRole('textbox', {name: 'Email address'})).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
  });

  test('login page: errors are announced and tied to their fields', async ({page}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Log in'}).click();

    await expect(emailField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField(page)).toHaveAccessibleDescription('Enter your email.');
    await expect(passwordField(page)).toHaveAccessibleDescription('Enter your password.');
    await expect(page.getByRole('alert')).toHaveCount(2);
  });

  test('sign-up, forgot-password, reset, verify and 404 pages: one h1, one main, named controls', async ({page}) => {
    for (const path of ['/signup', '/forgot', '/reset', '/verify', '/no-such-page']) {
      await page.goto(path);
      await expect(h1(page), path).toHaveCount(1);
      await expect(page.getByRole('main'), path).toHaveCount(1);
      expect(await controlsWithoutAName(page), path).toEqual([]);
      expect(await nestedInteractiveControls(page), path).toEqual([]);
    }
  });

  // QA-025a: an action that navigates is one link, one tab stop, not a button inside a link.
  test('navigation actions are links, with no button nested in a link', async ({page}) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('link', {name: 'Back to home'})).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Back to home'})).toHaveCount(0);

    await page.goto('/reset');
    await expect(page.getByRole('link', {name: 'Get a new link'})).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Get a new link'})).toHaveCount(0);

    await page.goto('/verify');
    await expect(page.getByRole('main').getByRole('link', {name: 'Log in'})).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Log in'})).toHaveCount(0);

    await loginAsDemo(page);
    expect(await nestedInteractiveControls(page)).toEqual([]);
    await openProjects(page);
    await expect(page.getByRole('article')).toHaveCount(7);
    await expect(page.getByRole('button', {name: 'New Reel'})).toHaveCount(0);
    expect(await nestedInteractiveControls(page)).toEqual([]);

    // One Tab press moves from the header's New Reel link to the next control, not to a second stop on the same action.
    const newReel = page.getByRole('main').getByRole('link', {name: 'New Reel'}).first();
    await newReel.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name: '86 of 100 credits left'})).toBeFocused();
  });

  test('the 404 page works with the keyboard: Tab to "Back to home" and Enter', async ({page}) => {
    await page.goto('/no-such-page');
    await expect(h1(page)).toHaveText('Page not found');

    await tabTo(page, page.getByRole('link', {name: 'Back to home'}));
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('dashboard: one h1 and every control has an accessible name', async ({page}) => {
    await loginAsDemo(page);
    await expect(page.getByRole('region', {name: 'Recent Reels'}).getByRole('article')).toHaveCount(5);

    await expect(h1(page)).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    expect(await controlsWithoutAName(page)).toEqual([]);
  });

  test('projects library: one h1 and every control has an accessible name', async ({page}) => {
    await loginAsDemo(page);
    await openProjects(page);
    await expect(page.getByRole('article')).toHaveCount(7);

    await expect(h1(page)).toHaveCount(1);
    expect(await controlsWithoutAName(page)).toEqual([]);
  });

  test('login works with the keyboard only: Tab to the fields, Enter to submit', async ({page}) => {
    await page.goto('/login');
    await expect(h1(page)).toHaveText('Welcome back');

    await tabTo(page, emailField(page));
    await page.keyboard.type(DEMO_EMAIL);
    await page.keyboard.press('Tab');
    await expect(passwordField(page)).toBeFocused();
    await page.keyboard.type(DEMO_PASSWORD);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('login works with the keyboard only: Tab to the Log in button and press Enter', async ({page}) => {
    await page.goto('/login');
    await expect(h1(page)).toHaveText('Welcome back');

    await tabTo(page, emailField(page));
    await page.keyboard.type(DEMO_EMAIL);
    await tabTo(page, passwordField(page));
    await page.keyboard.type(DEMO_PASSWORD);
    await tabTo(page, page.getByRole('button', {name: 'Log in'}));
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app$/);
  });

  test('a failed keyboard login puts focus on the first field that needs fixing', async ({page}) => {
    await page.goto('/login');
    await tabTo(page, page.getByRole('button', {name: 'Log in'}));
    await page.keyboard.press('Enter');

    await expect(page.getByText('Enter your email.')).toBeVisible();
    await expect(emailField(page)).toBeFocused();
  });

  test('dashboard: the prompt and Create can be reached and used with the keyboard', async ({page}) => {
    await loginAsDemo(page);

    await tabTo(page, page.getByRole('textbox', {name: "What's your next Reel about?"}));
    await page.keyboard.type('Keyboard only');
    await tabTo(page, page.getByRole('button', {name: 'Create'}));
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app\/new\?/);
    expect(new URL(page.url()).searchParams.get('topic')).toBe('Keyboard only');
  });
});

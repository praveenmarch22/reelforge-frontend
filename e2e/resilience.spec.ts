import {expect, test, type Page} from '@playwright/test';
import {
  ALL_DEMO_REELS,
  apiGet,
  askToDelete,
  deleteDialog,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_REELS,
  expectReels,
  faultHits,
  h1,
  installFaultInjection,
  loginAsDemo,
  logOut,
  NEW_USER,
  openProjects,
  reelCard,
  setFaults,
  signUp,
  submitLogin,
} from './helpers';

// Regression tests for the QA report (backend/docs/qa/QA_REPORT_F1-F3.md): what the app does when
// the session ends, a request fails, or another tab changed things. Failures are injected by
// wrapping fetch in the page (see helpers.ts), because the mock API never fails on its own.

const statusFilter = (page: Page, name: string) =>
  page.getByRole('group', {name: 'Filter by status'}).getByRole('button', {name, exact: true});
const LOAD_ERROR = "We couldn't load your Reels.";
const NETWORK_ERROR = "Can't reach ReelForge. Check your connection and try again.";

test.describe('QA-003: the session ends while the app is open', () => {
  test('logged out in another tab: the next request sends this tab to login, and logging in returns to the same page', async ({
    page,
    context,
  }) => {
    await loginAsDemo(page);
    await openProjects(page);
    // A view with nothing in progress, so this tab makes no requests until it is used.
    await statusFilter(page, 'Posted').click();
    await expectReels(page, DEMO_REELS.posted);

    const otherTab = await context.newPage();
    await otherTab.goto('/app/settings');
    await expect(h1(otherTab)).toHaveText('Settings');
    await logOut(otherTab);

    await statusFilter(page, 'Drafts').click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page)).toHaveText('Welcome back');
    await expect(page.getByRole('button', {name: 'Account menu'})).toHaveCount(0);

    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app\/projects$/);
    await expect(h1(page)).toHaveText('Your Reels');
  });

  test('access token expired and the refresh is refused: the app goes to login and comes back after logging in', async ({
    page,
  }) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    await openProjects(page);
    await statusFilter(page, 'Posted').click();
    await expectReels(page, DEMO_REELS.posted);

    await setFaults(page, [
      {method: 'GET', path: '/projects', status: 401, code: 'token_expired', message: 'Your session expired.'},
      {method: 'POST', path: '/auth/refresh', status: 401, code: 'not_authenticated', message: 'Please log in to continue.'},
    ]);
    await statusFilter(page, 'Drafts').click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page)).toHaveText('Welcome back');
    expect(await faultHits(page, 1), 'the refresh was attempted').toBeGreaterThan(0);

    await setFaults(page, []);
    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app\/projects$/);
    await expectReels(page, ALL_DEMO_REELS);
  });

  test('access token expired and the refresh works: the user notices nothing', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    await openProjects(page);
    await statusFilter(page, 'Posted').click();
    await expectReels(page, DEMO_REELS.posted);

    await setFaults(page, [
      {method: 'GET', path: '/projects', status: 401, code: 'token_expired', message: 'Your session expired.', times: 1},
    ]);
    await statusFilter(page, 'Drafts').click();

    await expectReels(page, DEMO_REELS.draft);
    await expect(page).toHaveURL(/\/app\/projects$/);
    expect(await faultHits(page)).toBe(1);
  });
});

test.describe('QA-004 and QA-005: resending the verification email', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
    await signUp(page);
  });

  test('the banner shows the error when the resend is refused or cannot be sent, and recovers', async ({page}) => {
    await page.goto('/app');
    const resend = page.getByRole('button', {name: 'Resend email'});
    await expect(resend).toBeVisible();

    await setFaults(page, [
      {method: 'POST', path: '/auth/resend-verification', status: 429, code: 'rate_limited', message: 'Too many emails. Try again in an hour.'},
    ]);
    await resend.click();
    await expect(page.getByRole('alert').filter({hasText: 'Too many emails. Try again in an hour.'})).toBeVisible();
    await expect(page.getByText('Sent', {exact: true})).toHaveCount(0);

    await setFaults(page, [{method: 'POST', path: '/auth/resend-verification', status: 0}]);
    await resend.click();
    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();

    await setFaults(page, []);
    await resend.click();
    await expect(page.getByText('Sent', {exact: true})).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the check-your-inbox screen shows the error too', async ({page}) => {
    await setFaults(page, [
      {method: 'POST', path: '/auth/resend-verification', status: 429, code: 'rate_limited', message: 'Too many emails. Try again in an hour.'},
    ]);
    await page.getByRole('button', {name: 'Resend email'}).click();

    await expect(page.getByRole('alert').filter({hasText: 'Too many emails. Try again in an hour.'})).toBeVisible();
    await expect(page.getByText('Sent. It can take a minute to arrive.')).toHaveCount(0);
  });

  test('an expired access token is refreshed and the resend goes through', async ({page}) => {
    await setFaults(page, [
      {method: 'POST', path: '/auth/resend-verification', status: 401, code: 'token_expired', message: 'Your session expired.', times: 1},
    ]);
    await page.getByRole('button', {name: 'Resend email'}).click();

    await expect(page.getByText('Sent. It can take a minute to arrive.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await faultHits(page)).toBe(1);
  });
});

test.describe('QA-006: log out that fails', () => {
  for (const [label, status] of [
    ['the connection drops', 0],
    ['the server answers 500', 500],
  ] as const) {
    test(`when ${label}, the user is told and stays signed in`, async ({page}) => {
      await installFaultInjection(page);
      await loginAsDemo(page);
      await setFaults(page, [{method: 'POST', path: '/auth/logout', status}]);

      await page.getByRole('button', {name: 'Account menu'}).click();
      await page.getByRole('menuitem', {name: 'Log out'}).click();

      await expect(
        page.getByRole('alert').filter({hasText: "Couldn't log out. Check your connection and try again."}),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/app$/);

      await page.reload();
      await expect(h1(page)).toHaveText(/^Hey /);

      // Once the connection is back, logging out works.
      await setFaults(page, []);
      await logOut(page);
      await page.goto('/app');
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test('a 401 from log out means the session was already gone, and counts as logged out', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    // The server no longer knows this session: log out and "who am I" both answer 401.
    await setFaults(page, [
      {method: 'POST', path: '/auth/logout', status: 401, code: 'not_authenticated', message: 'Please log in to continue.'},
      {method: 'GET', path: '/me', status: 401, code: 'not_authenticated', message: 'Please log in to continue.'},
    ]);

    await page.getByRole('button', {name: 'Account menu'}).click();
    await page.getByRole('menuitem', {name: 'Log out'}).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page)).toHaveText('Welcome back');
    await expect(page.getByText(/couldn't log out/i)).toHaveCount(0);
  });

  test('"Start again" on the check-your-inbox screen says so when the log out fails', async ({page}) => {
    await installFaultInjection(page);
    await signUp(page);
    await setFaults(page, [{method: 'POST', path: '/auth/logout', status: 0}]);

    await page.getByRole('button', {name: 'Start again'}).click();

    await expect(page.getByRole('alert').filter({hasText: "Couldn't sign you out. Try again."})).toBeVisible();
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.getByText(`We sent a verification link to ${NEW_USER.email}.`)).toBeVisible();
    await expect(page.getByRole('button', {name: 'Resend email'})).toBeVisible();
  });

  test('after logging out, the next login starts at Home, not on the page the last session was on', async ({page}) => {
    await loginAsDemo(page);
    await openProjects(page);
    await logOut(page);

    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });
});

test.describe('QA-008 and QA-014: delete dialog errors', () => {
  test('a failed delete shows its error, and the error is gone when the dialog is opened again', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    await openProjects(page);
    await setFaults(page, [
      {method: 'DELETE', path: '/projects/*', status: 500, code: 'internal_error', message: 'The server had a problem. Try again.', times: 1},
    ]);
    const failed = DEMO_REELS.draft[0];
    const dialogError = deleteDialog(page).getByRole('alert');

    await askToDelete(page, failed);
    await deleteDialog(page).getByRole('button', {name: 'Delete'}).click();
    await expect(dialogError).toHaveText(/The server had a problem\. Try again\./);
    await expect(deleteDialog(page)).toBeVisible();
    await deleteDialog(page).getByRole('button', {name: 'Cancel'}).click();
    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, ALL_DEMO_REELS);

    // Another Reel: a clean confirmation.
    await askToDelete(page, DEMO_REELS.posted[0]);
    await expect(dialogError).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(deleteDialog(page)).toBeHidden();

    // The same Reel again: clean too, and this time the delete goes through.
    await askToDelete(page, failed);
    await expect(dialogError).toHaveCount(0);
    await deleteDialog(page).getByRole('button', {name: 'Delete'}).click();
    await expect(deleteDialog(page)).toBeHidden();
    await expectReels(page, ALL_DEMO_REELS.filter((t) => t !== failed));
  });

  test('deleting a Reel that another tab already deleted closes the dialog and refreshes the list', async ({page, context}) => {
    const title = DEMO_REELS.draft[0];
    await loginAsDemo(page);
    await openProjects(page);
    // A view with nothing in progress, so this tab does not refresh itself in the meantime.
    await statusFilter(page, 'Drafts').click();
    await expectReels(page, [title]);

    const otherTab = await context.newPage();
    await otherTab.goto('/app/projects');
    await askToDelete(otherTab, title);
    await deleteDialog(otherTab).getByRole('button', {name: 'Delete'}).click();
    await expect(reelCard(otherTab, title)).toHaveCount(0);

    await askToDelete(page, title);
    await deleteDialog(page).getByRole('button', {name: 'Delete'}).click();

    await expect(deleteDialog(page)).toBeHidden();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(reelCard(page, title)).toHaveCount(0);
    await expect(page.getByText('No Reels match')).toBeVisible();
  });
});

test.describe('QA-009: the verify page while the account is loading or cannot be loaded', () => {
  const signedOutHint = 'Log in to get a new verification link.';

  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
    await signUp(page);
  });

  test('a slow account load shows a loading state, never the signed-out screen', async ({page}) => {
    await setFaults(page, [{method: 'GET', path: '/me', delayMs: 2500}]);
    await page.reload();

    await expect(page.getByText('Loading...')).toBeVisible();
    expect(await page.getByText(signedOutHint).count()).toBe(0);
    expect(await page.getByRole('main').getByRole('link', {name: 'Log in'}).count()).toBe(0);

    await expect(page.getByText(`We sent a verification link to ${NEW_USER.email}.`)).toBeVisible({timeout: 15_000});
    await expect(page.getByRole('button', {name: 'Resend email'})).toBeVisible();
    await expect(page.getByText(signedOutHint)).toHaveCount(0);
  });

  test('a failed account load shows an error with a retry that works', async ({page}) => {
    await setFaults(page, [{method: 'GET', path: '/me', status: 500}]);
    await page.reload();

    await expect(h1(page)).toHaveText("We couldn't load your account");
    await expect(page.getByText(signedOutHint)).toHaveCount(0);

    await setFaults(page, []);
    await page.getByRole('button', {name: 'Try again'}).click();

    await expect(h1(page)).toHaveText('Check your inbox');
    await expect(page.getByText(`We sent a verification link to ${NEW_USER.email}.`)).toBeVisible();
  });

  test('a bad link opened while the account is still loading does not show the signed-out screen', async ({page}) => {
    await setFaults(page, [{method: 'GET', path: '/me', delayMs: 4000}]);
    await page.goto('/verify?token=not-a-real-token');

    const signedOutAction = page.getByRole('link', {name: 'Log in to get a new link'});
    const resend = page.getByRole('button', {name: 'Resend email'});
    // Whichever of the two the page offers first...
    await expect(signedOutAction.or(resend)).toBeVisible({timeout: 15_000});
    // ...it must not be the one for signed-out visitors: this user is signed in.
    expect(await signedOutAction.count()).toBe(0);
    await expect(resend).toBeVisible();
  });
});

test.describe('QA-011: a failed request for the Reel list', () => {
  test('dashboard: failed background polls keep the tiles and the cards on screen', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    const recent = page.getByRole('region', {name: 'Recent Reels'});
    await expect(recent.getByRole('article')).toHaveCount(5);

    // One Reel is generating, so the page polls. Every poll now fails.
    await setFaults(page, [{method: 'GET', path: '/projects', status: 0}]);
    // Each poll is tried twice; four failed requests means at least one whole poll has failed.
    await expect.poll(() => faultHits(page), {timeout: 45_000}).toBeGreaterThanOrEqual(4);

    await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Summary'})).toContainText(/Reels made\s*7/);
    await expect(recent.getByRole('article')).toHaveCount(5);

    // When the connection is back, live progress carries on.
    const bar = reelCard(page, DEMO_REELS.generating[0]).getByRole('progressbar');
    const before = Number(await bar.getAttribute('aria-valuenow'));
    await setFaults(page, []);
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), {timeout: 30_000}).toBeGreaterThan(before);
  });

  test('library: failed background polls keep the list on screen', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    await openProjects(page);
    await expectReels(page, ALL_DEMO_REELS);

    await setFaults(page, [{method: 'GET', path: '/projects', status: 500}]);
    await expect.poll(() => faultHits(page), {timeout: 45_000}).toBeGreaterThanOrEqual(4);

    await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);
    await expectReels(page, ALL_DEMO_REELS);
  });

  for (const [name, path, loaded] of [
    ['dashboard', '/app', (page: Page) => expect(page.getByRole('region', {name: 'Summary'})).toContainText(/Reels made\s*7/)],
    ['library', '/app/projects', (page: Page) => expectReels(page, ALL_DEMO_REELS)],
  ] as const) {
    test(`${name}: when the first load fails there is an error with a retry that works`, async ({page}) => {
      await installFaultInjection(page);
      await loginAsDemo(page);
      await setFaults(page, [{method: 'GET', path: '/projects', status: 500}]);
      await page.goto(path);

      await expect(page.getByRole('alert').filter({hasText: LOAD_ERROR})).toBeVisible({timeout: 15_000});
      await expect(page.getByRole('article')).toHaveCount(0);

      await setFaults(page, []);
      await page.getByRole('button', {name: 'Try again'}).click();

      await loaded(page);
      await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);
    });
  }
});

test.describe('QA-016: credits reset wording', () => {
  test('says "1 day", "Today" and "2 days", never "1 days"', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    const me = await apiGet<{user: {credits: {balance: number; monthlyAllowance: number; resetsAt: string}}}>(page, '/me');
    const summary = page.getByRole('region', {name: 'Summary'});
    const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

    for (const [hours, wording] of [
      [12, '1 day'],
      [36, '2 days'],
      [-1, 'Today'],
    ] as const) {
      const user = {...me.user, credits: {...me.user.credits, resetsAt: hoursFromNow(hours)}};
      await setFaults(page, [{method: 'GET', path: '/me', status: 200, body: {user}}]);
      await page.reload();

      // The tile reads: label, value, then "86 of 100 left".
      await expect(summary, `${hours} h from now`).toContainText(new RegExp(`Credits reset in\\s*${wording}\\s*86 of 100 left`));
    }
  });
});

test.describe('QA-019 and QA-020: long text and lengths on cards', () => {
  test('a very long title without spaces stays inside the delete dialog', async ({page}) => {
    await installFaultInjection(page);
    await loginAsDemo(page);
    await openProjects(page);
    const longTitle = 'Supercalifragilistic'.repeat(12); // 240 characters, no spaces
    const list = await apiGet<{items: {title: string}[]}>(page, '/projects?limit=100');
    list.items[0].title = longTitle;
    await setFaults(page, [{method: 'GET', path: '/projects', status: 200, body: list}]);
    await page.reload();
    await expect(reelCard(page, longTitle)).toBeVisible();

    await askToDelete(page, longTitle);

    const dialog = deleteDialog(page);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), 'nothing sticks out of the dialog').toBe(true);
    const dialogBox = (await dialog.boundingBox())!;
    const textBox = (await dialog.getByText(longTitle, {exact: false}).boundingBox())!;
    expect(textBox.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeInViewport();
    await expect(dialog.getByRole('button', {name: 'Delete'})).toBeInViewport();
  });

  // PRD 5.9 D1: every project shows its length.
  test('every card shows a length: the real one when known, the target length until then', async ({page}) => {
    await loginAsDemo(page);
    await openProjects(page);
    await expectReels(page, ALL_DEMO_REELS);

    await expect(reelCard(page, DEMO_REELS.draft[0]).getByText('~30s')).toBeVisible();
    await expect(reelCard(page, DEMO_REELS.generating[0]).getByText('~30s')).toBeVisible();
    await expect(reelCard(page, DEMO_REELS.posted[0]).getByText('0:31')).toBeVisible();
    await expect(reelCard(page, DEMO_REELS.rendered[0]).getByText('0:58')).toBeVisible();
    for (const title of ALL_DEMO_REELS) {
      await expect(reelCard(page, title).getByText(/^(~\d+s|\d+:\d\d)$/), title).toHaveCount(1);
    }
  });
});

import {expect, test, type Page} from '@playwright/test';
import {
  currentUser,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  endSession,
  expectOnboardingStep,
  h1,
  installFaultInjection,
  loginAsDemo,
  NEW_USER,
  setFaults,
  skipSetup,
  startOnboarding,
  submitLogin,
} from './helpers';

// F4 onboarding, step 3: connect Instagram.
// PRD flow 2, features I1 and I2, edge cases IG-1 (personal account) and IG-11 (not a tester);
// API_DESIGN.md F1 and F2. In mock mode the page at /mock/instagram stands in for Instagram's
// approval screen and finishes the connection the way the real callback (F2) would.

const NETWORK_ERROR = "Can't reach ReelForge. Check your connection and try again.";
const GENERIC_FAILURE = /something went wrong while connecting/i;
const NOT_CONNECTED = {connected: false, username: null, status: null, expiresAt: null};

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const connectButton = (page: Page) => button(page, 'Connect Instagram');
const failure = (page: Page) => page.getByRole('alert').filter({hasText: "We couldn't connect your account"});
const requirementNote = (page: Page) => page.getByText('Needs an Instagram Business or Creator account (free to switch).');
const switchSteps = (page: Page) => page.getByRole('listitem').filter({hasText: 'Switch to professional account'});

/** The answers the stand-in Instagram page offers. */
const ANSWER = {
  creator: 'Allow (Creator account)',
  business: 'Allow (Business account)',
  personal: 'Allow, but this is a personal account',
  denied: 'Deny the permissions',
  notTester: 'Account is not added as a tester',
} as const;

/** On step 3: presses the connect (or "Try again") button and waits for the stand-in Instagram page. */
async function goToInstagram(page: Page, buttonName = 'Connect Instagram') {
  await button(page, buttonName).click();
  await expect(page).toHaveURL(/\/mock\/instagram\?state=\w+/);
  await expect(h1(page)).toHaveText('Instagram (mock)');
}

/** On the stand-in Instagram page: answers, optionally as the given account. */
async function answerInstagram(page: Page, answer: string, username?: string) {
  if (username !== undefined) await page.getByLabel('Instagram username').fill(username);
  await button(page, answer).click();
}

async function expectConnected(page: Page, username: string) {
  await expectOnboardingStep(page, 3, 'Instagram connected');
  // PRD flow 2 step 5: "show Connected as @username".
  await expect(page.getByText(`Connected as @${username}`, {exact: true})).toBeVisible();
  await expect(button(page, 'Finish')).toBeEnabled();
  await expect(connectButton(page)).toHaveCount(0);
  await expect(button(page, 'Skip for now')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

/**
 * A connect attempt that failed outright (API F2: state missing, invalid, expired, used, or another
 * user's) reached a user who is still in the setup: they are on step 3, told so, and can try again.
 */
async function expectGenericFailureOnStep3(page: Page) {
  await expect(page).toHaveURL(/\/onboarding\?step=3&instagram=error&reason=failed$/);
  await expectOnboardingStep(page, 3);
  await expect(failure(page)).toContainText(GENERIC_FAILURE);
  await expect(button(page, 'Try again')).toBeEnabled();
  await expect(button(page, 'Skip for now')).toBeEnabled();
}

test.describe('step 3: before connecting', () => {
  test('explains the Business or Creator requirement, and "How to switch" opens and closes the steps', async ({page}) => {
    await startOnboarding(page, 3);

    await expect(page.getByText('Post your Reels straight from ReelForge.')).toBeVisible();
    await expect(requirementNote(page)).toBeVisible();
    await expect(connectButton(page)).toBeEnabled();
    await expect(button(page, 'Skip for now')).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);

    const toggle = button(page, 'How to switch');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(switchSteps(page)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(switchSteps(page)).toBeVisible();
    await expect(page.getByRole('listitem').filter({hasText: /Creator/})).not.toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(switchSteps(page)).toHaveCount(0);
  });

  test('"Skip for now" finishes the setup without connecting; the dashboard offers to connect', async ({page}) => {
    await startOnboarding(page, 3);

    await button(page, 'Skip for now').click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByRole('link', {name: 'Connect Instagram'})).toBeVisible();
    const user = await currentUser(page);
    expect(user.onboardingCompleted).toBe(true);
    expect(user.instagram).toEqual(NOT_CONNECTED);
  });

  test('a result in the URL is not trusted: instagram=connected without a connection shows the step as not connected, and an unknown reason shows the generic failure', async ({page}) => {
    await startOnboarding(page, 1);

    await page.goto('/onboarding?step=3&instagram=connected');
    await expectOnboardingStep(page, 3);
    await expect(connectButton(page)).toBeVisible();
    await expect(button(page, 'Finish')).toHaveCount(0);

    await page.goto('/onboarding?step=3&instagram=error&reason=no-such-reason');
    await expectOnboardingStep(page, 3);
    await expect(failure(page)).toContainText(GENERIC_FAILURE);
    await expect(button(page, 'Try again')).toBeEnabled();
  });

  // QA-028: reason=__proto__ used to leave a blank page, and toString/constructor a failure with no reason.
  // API F2: "The web app treats any reason it does not know as failed."
  test('a reason that is the name of something every JavaScript object has shows the generic failure, not a blank page', async ({page}) => {
    await startOnboarding(page, 1);

    for (const reason of ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      await page.goto(`/onboarding?step=3&instagram=error&reason=${reason}`);

      await expectOnboardingStep(page, 3);
      await expect(failure(page), reason).toContainText(GENERIC_FAILURE);
      await expect(button(page, 'Try again'), reason).toBeEnabled();
      await expect(button(page, 'Skip for now'), reason).toBeEnabled();
    }

    // No reason at all, and an empty one.
    for (const query of ['instagram=error', 'instagram=error&reason=']) {
      await page.goto(`/onboarding?step=3&${query}`);
      await expect(failure(page), query).toContainText(GENERIC_FAILURE);
    }
  });
});

test.describe('step 3: connecting', () => {
  // PRD flow 2 step 5: "Business or Creator: show Connected as @username."
  test('connecting a Creator account shows the username on the step and, after Finish, in the dashboard', async ({page}) => {
    await startOnboarding(page, 3);

    await goToInstagram(page);
    await answerInstagram(page, ANSWER.creator, 'asha_creates');

    await expect(page).toHaveURL(/\/onboarding\?step=3&instagram=connected$/);
    await expectConnected(page, 'asha_creates');
    await expect(requirementNote(page)).toHaveCount(0);
    expect((await currentUser(page)).instagram).toMatchObject({connected: true, username: 'asha_creates', status: 'connected'});
    // Connecting is not finishing: the setup is still open until Finish.
    expect((await currentUser(page)).onboardingCompleted).toBe(false);

    await button(page, 'Finish').click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByRole('link', {name: /@asha_creates/})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Connect Instagram'})).toHaveCount(0);
    expect((await currentUser(page)).onboardingCompleted).toBe(true);
  });

  test('a Business account connects too, and the connected state is still shown after a reload, after Back, and without the result in the URL', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.business, 'asha_studio');
    await expectConnected(page, 'asha_studio');

    await page.reload();
    await expectConnected(page, 'asha_studio');

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await button(page, 'Skip for now').click();
    await expect(page).toHaveURL(/\/onboarding\?step=3$/);
    await expectConnected(page, 'asha_studio');

    await page.goto('/onboarding?step=3');
    await expectConnected(page, 'asha_studio');
  });

  test('"Skip setup" after connecting keeps the connection', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');

    await button(page, 'Skip setup').click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', {name: /@asha_creates/})).toBeVisible();
  });

  const refusals = [
    {
      name: 'a personal account (IG-1)',
      answer: ANSWER.personal,
      reason: 'personal_account',
      message: /personal account.*Business or Creator account/i,
    },
    {name: 'permissions refused', answer: ANSWER.denied, reason: 'denied', message: /declined the permissions/i},
    {name: 'not added as a tester (IG-11)', answer: ANSWER.notTester, reason: 'not_tester', message: /tester/i},
  ];

  for (const {name, answer, reason, message} of refusals) {
    test(`${name}: shows its own reason, stores nothing, and offers "Try again"`, async ({page}) => {
      await startOnboarding(page, 3);
      await goToInstagram(page);

      await answerInstagram(page, answer, 'asha_creates');

      await expect(page).toHaveURL(new RegExp(`/onboarding\\?step=3&instagram=error&reason=${reason}$`));
      await expectOnboardingStep(page, 3);
      await expect(failure(page)).toBeVisible();
      await expect(failure(page)).toContainText(message);
      // Only this reason, not the others.
      for (const other of refusals.filter((r) => r.reason !== reason)) {
        await expect(failure(page)).not.toContainText(other.message);
      }
      await expect(failure(page)).not.toContainText(GENERIC_FAILURE);

      if (reason === 'personal_account') {
        // IG-1: "Block at connect time with instructions to switch to Creator or Business."
        await expect(failure(page).getByRole('listitem').filter({hasText: 'Switch to professional account'})).toBeVisible();
        await expect(failure(page).getByRole('listitem')).toHaveCount(3);
      } else {
        await expect(failure(page).getByRole('listitem')).toHaveCount(0);
        await expect(requirementNote(page)).toBeVisible();
      }

      // PRD flow 2: "Store nothing."
      expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);
      await expect(page.getByText('@asha_creates')).toHaveCount(0);
      await expect(button(page, 'Try again')).toBeEnabled();
      await expect(button(page, 'Skip for now')).toBeEnabled();
      await expect(button(page, 'Finish')).toHaveCount(0);

      // The message is still there after a reload (the result is in the URL).
      await page.reload();
      await expect(failure(page)).toContainText(message);
    });
  }

  test('"Try again" after a failure starts a new attempt, and a success clears the failure', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.personal);
    await expect(failure(page)).toBeVisible();

    await goToInstagram(page, 'Try again');
    await answerInstagram(page, ANSWER.denied);
    await expect(failure(page)).toContainText(/declined the permissions/i);
    await expect(failure(page)).not.toContainText(/personal account/i);

    await goToInstagram(page, 'Try again');
    await answerInstagram(page, ANSWER.creator, 'asha_creates');

    await expectConnected(page, 'asha_creates');
    await expect(failure(page)).toHaveCount(0);
  });

  test('after a failure the user can still finish without connecting', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.notTester);
    await expect(failure(page)).toBeVisible();

    await button(page, 'Skip for now').click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', {name: 'Connect Instagram'})).toBeVisible();
    expect((await currentUser(page)).onboardingCompleted).toBe(true);
  });
});

test.describe('step 3: when a request fails', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
  });

  test('an error from GET /instagram/connect is shown, the user stays on the step, and a retry works', async ({page}) => {
    await startOnboarding(page, 3);
    // The one error F1 documents. (That the mock API gives it to unverified users is checked in handlers.test.ts.)
    const message = 'Verify your email before connecting Instagram.';

    await setFaults(page, [{method: 'GET', path: '/instagram/connect', status: 403, code: 'email_not_verified', message}]);
    await connectButton(page).click();

    await expect(page.getByRole('alert').filter({hasText: message})).toBeVisible();
    await expectOnboardingStep(page, 3);
    expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);
    await expect(connectButton(page)).toBeEnabled();
    await expect(button(page, 'Skip for now')).toBeEnabled();
    await expect(button(page, 'Back')).toBeEnabled();

    await setFaults(page, [{method: 'GET', path: '/instagram/connect', status: 0}]);
    await connectButton(page).click();
    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();
    await expectOnboardingStep(page, 3);

    await setFaults(page, []);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');
  });

  test('when Finish cannot be saved, an error is shown and the user stays on the step, still connected', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');
    const message = 'We could not save that. Try again in a moment.';

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 500, code: 'internal_error', message}]);
    await button(page, 'Finish').click();

    await expect(page.getByRole('alert').filter({hasText: message})).toBeVisible();
    await expectOnboardingStep(page, 3, 'Instagram connected');
    await expect(page.getByText('Connected as @asha_creates', {exact: true})).toBeVisible();
    await expect(button(page, 'Finish')).toBeEnabled();
    expect((await currentUser(page)).onboardingCompleted).toBe(false);

    await setFaults(page, []);
    await button(page, 'Finish').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', {name: /@asha_creates/})).toBeVisible();
  });

  test('when "Skip for now" cannot be saved, an error is shown and the user stays on the step', async ({page}) => {
    await startOnboarding(page, 3);

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 0}]);
    await button(page, 'Skip for now').click();

    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();
    await expectOnboardingStep(page, 3);
    await expect(button(page, 'Skip for now')).toBeEnabled();
    await expect(connectButton(page)).toBeEnabled();

    await setFaults(page, []);
    await button(page, 'Skip for now').click();
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('the state of a connect attempt (F2)', () => {
  // F2: "If state is missing or invalid it redirects to /app/settings?instagram=error&reason=failed."
  for (const [label, query] of [
    ['an unknown state', '?state=not-a-real-state'],
    ['no state at all', ''],
  ]) {
    test(`${label} ends in the generic failure on the settings page and changes nothing`, async ({page}) => {
      await loginAsDemo(page);
      const before = (await currentUser(page)).instagram;
      await page.goto(`/mock/instagram${query}`);
      await expect(h1(page)).toHaveText('Instagram (mock)');

      await answerInstagram(page, ANSWER.creator, 'someone_else');

      await expect(page).toHaveURL(/\/app\/settings\?instagram=error&reason=failed$/);
      // The redirect is a full page load: wait for the page before asking the mock API anything.
      await expect(h1(page)).toHaveText('Settings');
      expect((await currentUser(page)).instagram).toEqual(before);
    });
  }

  test('a state that was already used cannot connect an account afterwards', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    const instagramUrl = page.url();
    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');

    // The same approval page again, for example from the browser history.
    await page.goto(instagramUrl);
    await expect(h1(page)).toHaveText('Instagram (mock)');
    await answerInstagram(page, ANSWER.business, 'someone_else');

    // The replay fails; the user is brought back to step 3, where the first account is still the one connected.
    await expect(page).toHaveURL(/\/onboarding\?step=3&instagram=error&reason=failed$/);
    await expectConnected(page, 'asha_creates');
    expect((await currentUser(page)).instagram).toMatchObject({connected: true, username: 'asha_creates'});
  });

  // During onboarding the generic failure has to reach the user as well: the F2 redirect goes to
  // /app/settings, which a user who has not finished the setup cannot open.
  test('a used state during onboarding ends in the generic failure message, not in silence', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    const instagramUrl = page.url();
    await answerInstagram(page, ANSWER.denied);
    await expect(failure(page)).toBeVisible();

    await page.goto(instagramUrl);
    await expect(h1(page)).toHaveText('Instagram (mock)');
    await answerInstagram(page, ANSWER.creator, 'asha_creates');

    await expectGenericFailureOnStep3(page);
    expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);
  });

  // QA-027, the everyday version: two tabs (or two clicks) start two attempts; the second replaces the first.
  test('an attempt that was replaced by a newer one ends in the generic failure on step 3, and "Try again" then connects', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    const firstAttempt = page.url();
    await page.goto('/onboarding?step=3');
    await expectOnboardingStep(page, 3);
    await goToInstagram(page);
    expect(page.url()).not.toBe(firstAttempt);

    await page.goto(firstAttempt);
    await expect(h1(page)).toHaveText('Instagram (mock)');
    await answerInstagram(page, ANSWER.creator, 'asha_creates');

    await expectGenericFailureOnStep3(page);
    expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);

    await goToInstagram(page, 'Try again');
    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');
  });

  for (const [label, query] of [
    ['an unknown state', '?state=not-a-real-state'],
    ['no state at all', ''],
  ]) {
    test(`${label} during onboarding ends in the generic failure on step 3`, async ({page}) => {
      await startOnboarding(page, 2);
      await page.goto(`/mock/instagram${query}`);
      await expect(h1(page)).toHaveText('Instagram (mock)');

      await answerInstagram(page, ANSWER.creator, 'asha_creates');

      await expectGenericFailureOnStep3(page);
      expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);
    });
  }

  // F2's fallback address is /app/settings?instagram=error&reason=failed. Whatever result arrives on an
  // app page while the setup is not finished is shown on the setup's Instagram step.
  test('an Instagram result that arrives on an app page during onboarding is shown on step 3 with its reason', async ({page}) => {
    await startOnboarding(page, 1);

    await page.goto('/app/settings?instagram=error&reason=failed');
    await expectGenericFailureOnStep3(page);

    await page.goto('/app/settings?instagram=error&reason=denied');
    await expect(page).toHaveURL(/\/onboarding\?step=3&instagram=error&reason=denied$/);
    await expectOnboardingStep(page, 3);
    await expect(failure(page)).toContainText(/declined the permissions/i);

    await page.goto('/app?instagram=error&reason=__proto__');
    await expectOnboardingStep(page, 3);
    await expect(failure(page)).toContainText(GENERIC_FAILURE);

    // A claimed success is carried too, and is still not trusted.
    await page.goto('/app/settings?instagram=connected');
    await expect(page).toHaveURL(/\/onboarding\?step=3&instagram=connected$/);
    await expectOnboardingStep(page, 3);
    await expect(connectButton(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // After the setup, the same address stays on Settings.
    await skipSetup(page);
    await page.goto('/app/settings?instagram=error&reason=failed');
    await expect(h1(page)).toHaveText('Settings');
    await expect(page).toHaveURL(/\/app\/settings\?instagram=error&reason=failed$/);
  });

  // F2: the callback also checks "that the signed-in user is the user inside state. This stops one
  // person's approval link from connecting another person's account." (QA question 2.)
  test("another user who logs in on the same browser and approves the first user's link connects neither account", async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    const ashasApprovalLink = page.url();

    await endSession(page);
    await page.goto('/login');
    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(h1(page)).toHaveText(/^Hey /);
    const demoBefore = (await currentUser(page)).instagram;

    await page.goto(ashasApprovalLink);
    await expect(h1(page)).toHaveText('Instagram (mock)');
    await answerInstagram(page, ANSWER.creator, 'someone_else');

    // The demo user has finished the setup, so the generic failure lands on Settings.
    await expect(page).toHaveURL(/\/app\/settings\?instagram=error&reason=failed$/);
    await expect(h1(page)).toHaveText('Settings');
    expect((await currentUser(page)).instagram).toEqual(demoBefore);

    // Asha's account is untouched, and the link is no use to her either now.
    await endSession(page);
    await page.goto('/login');
    await submitLogin(page, NEW_USER.email, NEW_USER.password);
    await expectOnboardingStep(page, 1);
    expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);
    await page.goto('/onboarding?step=3');
    await expectOnboardingStep(page, 3);
    await expect(connectButton(page)).toBeEnabled();
  });

  test('an approval link opened after logging out leads to the login page, and connects nothing', async ({page}) => {
    await startOnboarding(page, 3);
    await goToInstagram(page);
    const approvalLink = page.url();
    await endSession(page);

    await page.goto(approvalLink);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', {name: 'Log in'})).toBeVisible();
    // Opening the link without a session connected nothing. Logging in as the same user brings
    // the approval page back (the page that was asked for), and approving then works.
    await submitLogin(page, NEW_USER.email, NEW_USER.password);
    await expect(h1(page)).toHaveText('Instagram (mock)');
    expect((await currentUser(page)).instagram).toEqual(NOT_CONNECTED);

    await answerInstagram(page, ANSWER.creator, 'asha_creates');
    await expectConnected(page, 'asha_creates');
  });
});

import {expect, test, type Page} from '@playwright/test';
import {
  currentUser,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  endSession,
  expectOnboardingStep,
  h1,
  installFaultInjection,
  NEW_USER,
  setFaults,
  startOnboarding,
  submitLogin,
} from './helpers';

// Onboarding step 3: connect YouTube (F7; YouTube first, decision 2026-11-26).
// docs/PUBLISHING_YOUTUBE.md: connect flow, YT-3 (no channel), F1, F2. In mock mode the page at
// /mock/youtube stands in for Google's sign-in and finishes the connection the way F2 would.
// Replaces onboarding-instagram.spec.ts (Instagram returns with B6b).

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const connectButton = (page: Page) => button(page, 'Connect YouTube');
const failure = (page: Page) => page.getByRole('alert').filter({hasText: "We couldn't connect your channel"});

/** The answers the stand-in Google page offers. */
const ANSWER = {
  allow: 'Allow',
  denied: 'Deny the permissions',
  missingPermission: 'Allow, but untick "Manage your YouTube videos"',
  noChannel: 'This account has no YouTube channel',
} as const;

/** On step 3: presses Connect (or Try again) and waits for the stand-in Google page. */
async function goToGoogle(page: Page, buttonName = 'Connect YouTube') {
  await button(page, buttonName).click();
  await expect(page).toHaveURL(/\/mock\/youtube\?state=\w+/);
  await expect(h1(page)).toHaveText('Google (mock)');
}

async function answerGoogle(page: Page, answer: string, channel?: string) {
  if (channel !== undefined) await page.getByLabel('Channel name').fill(channel);
  await button(page, answer).click();
}

async function expectConnected(page: Page, channel: string) {
  await expectOnboardingStep(page, 3, 'YouTube connected');
  await expect(page.getByText(new RegExp(`^Connected(?: as|:) ${channel}$`))).toBeVisible();
  await expect(button(page, 'Finish')).toBeEnabled();
  await expect(connectButton(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('step 3: before connecting', () => {
  test('explains the Google sign-in and testing limit, and offers Connect, Skip for now and Back', async ({page}) => {
    await startOnboarding(page, 3);
    await expect(page.getByText(/only accounts added as testers can connect/)).toBeVisible();
    for (const name of ['Connect YouTube', 'Skip for now', 'Back']) await expect(button(page, name)).toBeEnabled();
  });

  test('"Skip for now" finishes the setup without connecting', async ({page}) => {
    await startOnboarding(page, 3);
    await button(page, 'Skip for now').click();
    await expect(page).toHaveURL(/\/app$/);
    expect(await currentUser(page)).toMatchObject({onboardingCompleted: true, connections: {youtube: null}});
  });

  test('a result in the address is not trusted: connected=youtube without a connection still shows Connect', async ({page}) => {
    await startOnboarding(page, 3);
    await page.goto('/onboarding?step=3&connected=youtube');
    await expectOnboardingStep(page, 3);
    await expect(connectButton(page)).toBeEnabled();
    // Read once, then removed from the address.
    await expect(page).toHaveURL(/\/onboarding\?step=3$/);
  });
});

test.describe('step 3: connecting', () => {
  test('allowing shows the channel on the step; Finish completes the setup and the top bar shows the channel', async ({page}) => {
    await startOnboarding(page, 3);
    await goToGoogle(page);
    await answerGoogle(page, ANSWER.allow, 'Asha Shorts');

    await expectConnected(page, 'Asha Shorts');
    await expect(page).toHaveURL(/\/onboarding\?step=3$/); // the result was read once and removed
    expect((await currentUser(page)).connections.youtube).toMatchObject({status: 'connected', name: 'Asha Shorts'});
    expect((await currentUser(page)).onboardingCompleted).toBe(false);

    await button(page, 'Finish').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', {name: /Asha Shorts/})).toBeVisible();
  });

  test('the connected state stays after a reload', async ({page}) => {
    await startOnboarding(page, 3);
    await goToGoogle(page);
    await answerGoogle(page, ANSWER.allow, 'Asha Shorts');
    await expectConnected(page, 'Asha Shorts');
    await page.reload();
    await expectConnected(page, 'Asha Shorts');
  });

  for (const [name, answer, text] of [
    ['denied', ANSWER.denied, /didn't allow ReelForge to upload/],
    ['missing permission', ANSWER.missingPermission, /needs permission to upload videos/],
    ['no channel', ANSWER.noChannel, /has no YouTube channel yet/],
  ] as const) {
    test(`${name}: shows its own reason, stores nothing, and offers "Try again"`, async ({page}) => {
      await startOnboarding(page, 3);
      await goToGoogle(page);
      await answerGoogle(page, answer);

      await expectOnboardingStep(page, 3);
      await expect(failure(page)).toContainText(text);
      await expect(page).toHaveURL(/\/onboarding\?step=3$/);
      expect((await currentUser(page)).connections.youtube).toBeNull();
      await expect(button(page, 'Try again')).toBeEnabled();
      if (name === 'no channel') await expect(page.getByRole('link', {name: 'Create a YouTube channel'})).toBeVisible();
    });
  }

  test('"Try again" after a failure starts a new attempt, and a success clears the failure', async ({page}) => {
    await startOnboarding(page, 3);
    await goToGoogle(page);
    await answerGoogle(page, ANSWER.denied);
    await expect(failure(page)).toBeVisible();
    await goToGoogle(page, 'Try again');
    await answerGoogle(page, ANSWER.allow, 'Asha Shorts');
    await expectConnected(page, 'Asha Shorts');
  });
});

test.describe('step 3: when a request fails', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
  });

  test('an error from F1 is shown, the user stays on the step, and a retry works', async ({page}) => {
    await startOnboarding(page, 3);
    await setFaults(page, [{method: 'GET', path: '/connections/youtube/connect', status: 503, code: 'provider_unavailable', message: "Connecting YouTube isn't set up yet."}]);
    await connectButton(page).click();
    await expect(page.getByRole('alert')).toContainText("Connecting YouTube isn't set up yet.");
    await expectOnboardingStep(page, 3);
    await setFaults(page, []);
    await goToGoogle(page);
  });
});

test.describe('the state of a connect attempt (F2)', () => {
  test('a state that was already used cannot connect an account afterwards', async ({page}) => {
    await startOnboarding(page, 3);
    await goToGoogle(page);
    const link = page.url();
    await answerGoogle(page, ANSWER.denied);
    await expect(failure(page)).toBeVisible();

    await page.goto(link);
    await answerGoogle(page, ANSWER.allow, 'Someone');
    // The redirect is a full page load: wait for the page before asking the mock API anything.
    await expect(page).toHaveURL(/\/app\/settings|\/onboarding/);
    // Still in the setup, so the app sends the user back to it.
    await expect(h1(page)).toHaveText(/Connect YouTube|Settings|What do you post about\?/);
    expect((await currentUser(page)).connections.youtube).toBeNull();
  });

  test("another user who logs in on the same browser and approves the first user's link connects neither account", async ({page}) => {
    await startOnboarding(page, 3);
    await goToGoogle(page);
    const ashasLink = page.url();

    await endSession(page);
    await page.goto('/login');
    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(h1(page)).toHaveText(/^Hey /);
    const demoBefore = (await currentUser(page)).connections.youtube;

    await page.goto(ashasLink);
    await expect(h1(page)).toHaveText('Google (mock)');
    await answerGoogle(page, ANSWER.allow, 'Someone');
    await expect(page).toHaveURL(/\/app\/settings\?connection_error=youtube&reason=failed$/);
    await expect(h1(page)).toHaveText('Settings');
    expect((await currentUser(page)).connections.youtube).toEqual(demoBefore);

    await endSession(page);
    await page.goto('/login');
    await submitLogin(page, NEW_USER.email, NEW_USER.password);
    await expectOnboardingStep(page, 1);
    expect((await currentUser(page)).connections.youtube).toBeNull();
  });
});

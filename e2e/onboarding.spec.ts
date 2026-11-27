import {expect, test, type Page} from '@playwright/test';
import {listVoices} from '../src/mocks/db';
import {
  currentUser,
  endSession,
  expectOnboardingStep,
  expectSetupStepState,
  faultHits,
  h1,
  installFaultInjection,
  loginAsDemo,
  logOut,
  NEW_USER,
  onboardingTitle,
  patchProfile,
  releaseHeldRequests,
  setFaults,
  setupSteps,
  signUp,
  skipSetup,
  startOnboarding,
  submitLogin,
  tabTo,
  type OnboardingStep,
} from './helpers';

// F4 onboarding: who sees it, moving between the steps, the niche step and the voice step.
// PRD flow 1 step 4 ("3 short steps, all skippable") and feature A4; API_DESIGN.md A10, D3.
// The YouTube step is in onboarding-youtube.spec.ts.

const VERIFY_BANNER = 'Verify your email to start creating Reels.';
const NETWORK_ERROR = "Can't reach ReelForge. Check your connection and try again.";
const SAVE_FAILED = 'We could not save that. Try again in a moment.';
const failPatchMe = {method: 'PATCH', path: '/me', status: 500, code: 'internal_error', message: SAVE_FAILED} as const;

const VOICES = listVoices();
const VOICE_NAMES = VOICES.map((v) => v.name);

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const topics = (page: Page) => page.getByRole('group', {name: 'Topics'}).getByRole('button');
const topic = (page: Page, name: string) => page.getByRole('group', {name: 'Topics'}).getByRole('button', {name, exact: true});
const somethingElse = (page: Page) => page.getByLabel('Something else');
const chosenCount = (page: Page, n: number) => page.getByText(`${n} of 3 chosen`);
const voiceRadios = (page: Page) => page.getByRole('radiogroup', {name: 'Voices'}).getByRole('radio');
const voice = (page: Page, name: string) => page.getByRole('radio', {name: new RegExp(`^${name}\\b`)});
const playSample = (page: Page, name: string) => button(page, `Play ${name} sample`);
const stopSample = (page: Page, name: string) => button(page, `Stop ${name} sample`);

test.describe('who is sent to onboarding', () => {
  test('a new user who verifies their email lands on step 1, and every app page leads back there', async ({page}) => {
    await signUp(page);
    await page.getByRole('link', {name: 'Open the verification link'}).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expectOnboardingStep(page, 1);
    await expect(setupSteps(page).getByRole('listitem')).toHaveText([/Niche/, /Voice/, /YouTube/]);
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);

    for (const path of ['/app', '/app/projects', '/app/settings', '/']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/onboarding$/);
      await expectOnboardingStep(page, 1);
    }
    expect((await currentUser(page)).onboardingCompleted).toBe(false);
  });

  test('an unverified user is not sent to onboarding; they get the app with the verify banner', async ({page}) => {
    await signUp(page);

    for (const [path, title] of [
      ['/app', 'Welcome, Asha'],
      ['/app/projects', 'Your Reels'],
    ]) {
      await page.goto(path);
      await expect(h1(page)).toHaveText(title);
      await expect(page.getByText(VERIFY_BANNER)).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
    }
  });

  // PRD flow 1: the setup comes after the email is verified (steps 3 and 4). If an unverified user
  // could open it and press "Skip setup", they would never be shown it once they do verify.
  test('an unverified user who opens /onboarding by its address is taken to the app, cannot mark the setup done, and still gets it after verifying', async ({page}) => {
    await signUp(page);

    for (const address of ['/onboarding', '/onboarding?step=2', '/onboarding?step=3&connected=youtube']) {
      await page.goto(address);

      await expect(page, address).toHaveURL(/\/app$/);
      await expect(h1(page)).toHaveText('Welcome, Asha');
      await expect(page.getByText(VERIFY_BANNER)).toBeVisible();
      await expect(page.getByRole('button', {name: 'Skip setup'})).toHaveCount(0);
      await expect(setupSteps(page)).toHaveCount(0);
    }
    const user = await currentUser(page);
    expect(user).toMatchObject({emailVerified: false, onboardingCompleted: false, niche: ''});

    // Once the email is verified the setup is shown, as for any new user.
    await page.goto('/verify');
    await page.getByRole('link', {name: 'Open the verification link'}).click();
    await expectOnboardingStep(page, 1);
    await expect(page.getByRole('button', {name: 'Skip setup'})).toBeEnabled();
  });

  test('the demo account, which has done the setup, never sees it, and /onboarding takes it to the dashboard', async ({page}) => {
    await loginAsDemo(page);

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);

    await page.goto('/onboarding?step=3');
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('a user who skipped the setup is not shown it again: not after a reload, not on /onboarding, not at the next login', async ({page}) => {
    await startOnboarding(page);
    await skipSetup(page);
    await expect(page.getByRole('button', {name: 'Create your first Reel'})).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');

    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');

    await logOut(page);
    await submitLogin(page, NEW_USER.email, NEW_USER.password);
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
  });

  // PRD flow 1, steps 4 and 5: niche, voice, YouTube (skipped here), then the empty dashboard.
  test('a user who goes through all three steps lands on the empty dashboard with everything saved, and is not shown the setup again', async ({page}) => {
    await startOnboarding(page);

    await topic(page, 'Fitness').click();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    await voice(page, 'Bella').check();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 3);
    await button(page, 'Skip for now').click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByRole('button', {name: 'Create your first Reel'})).toBeVisible();
    expect(await currentUser(page)).toMatchObject({
      niche: 'Fitness',
      defaults: {voiceId: VOICES.find((v) => v.name === 'Bella')!.id},
      onboardingCompleted: true,
    });

    // The browser's Back button does not bring the setup back.
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');

    await page.goto('/onboarding?step=2');
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
  });

  test('a verified user who left during the setup is taken back to it at the next login', async ({page}) => {
    await startOnboarding(page);
    await endSession(page);
    await page.goto('/login');

    await submitLogin(page, NEW_USER.email, NEW_USER.password);

    await expectOnboardingStep(page, 1);
  });
});

test.describe('moving between the steps', () => {
  test('the step is in the URL: it survives a reload, and the browser Back and Forward buttons move between steps', async ({page}) => {
    await startOnboarding(page);

    await button(page, 'Skip for now').click();
    await expect(page).toHaveURL(/\/onboarding\?step=2$/);
    await expectOnboardingStep(page, 2);

    await button(page, 'Skip for now').click();
    await expect(page).toHaveURL(/\/onboarding\?step=3$/);
    await expectOnboardingStep(page, 3);

    await page.reload();
    await expect(page).toHaveURL(/\/onboarding\?step=3$/);
    await expectOnboardingStep(page, 3);

    await page.goBack();
    await expectOnboardingStep(page, 2);
    await page.goBack();
    await expectOnboardingStep(page, 1);
    await page.goForward();
    await expect(page).toHaveURL(/\/onboarding\?step=2$/);
    await expectOnboardingStep(page, 2);

    await page.reload();
    await expectOnboardingStep(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);
  });

  test('the Back buttons on steps 2 and 3 return to the step before', async ({page}) => {
    await startOnboarding(page, 3);

    await button(page, 'Back').click();
    await expect(page).toHaveURL(/\/onboarding\?step=2$/);
    await expectOnboardingStep(page, 2);

    await button(page, 'Back').click();
    await expect(page).toHaveURL(/\/onboarding\?step=1$/);
    await expectOnboardingStep(page, 1);
    await expect(button(page, 'Back')).toHaveCount(0);
  });

  for (const value of ['9', '0', 'abc', '2.5']) {
    test(`?step=${value} is not a step and shows step 1`, async ({page}) => {
      await startOnboarding(page, 2);

      await page.goto(`/onboarding?step=${value}`);

      await expectOnboardingStep(page, 1);
      await expect(topics(page)).toHaveCount(12);
    });
  }

  for (const step of [1, 2, 3] as OnboardingStep[]) {
    test(`"Skip setup" on step ${step} goes to the dashboard and saves nothing but "setup done"`, async ({page}) => {
      await startOnboarding(page, step);

      await skipSetup(page);

      await expect(page.getByRole('button', {name: 'Create your first Reel'})).toBeVisible();
      const user = await currentUser(page);
      expect(user.onboardingCompleted).toBe(true);
      expect(user.niche).toBe('');
      expect(user.defaults.voiceId).toBe('');
      expect(user.connections.youtube).toBeNull();
    });
  }

  test('when "Skip setup" cannot be saved, an error is shown and the user stays on the step', async ({page}) => {
    await installFaultInjection(page);
    await startOnboarding(page, 2);

    await setFaults(page, [failPatchMe]);
    await button(page, 'Skip setup').click();

    await expect(page.getByRole('alert').filter({hasText: SAVE_FAILED})).toBeVisible();
    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).onboardingCompleted).toBe(false);

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 0}]);
    await button(page, 'Skip setup').click();
    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();
    await expectOnboardingStep(page, 2);

    await setFaults(page, []);
    await skipSetup(page);
  });

  // QA-035: the message belongs to the attempt that failed, on the step where it failed.
  test('the error of a failed finish does not follow the user to another step', async ({page}) => {
    await installFaultInjection(page);
    await startOnboarding(page, 3);
    const anyAlert = page.getByRole('alert');

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 0}]);
    await button(page, 'Skip for now').click();
    await expect(anyAlert.filter({hasText: NETWORK_ERROR})).toBeVisible();

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(anyAlert).toHaveCount(0);

    // The same for "Skip setup" failing on step 2 and then moving forward or back.
    await button(page, 'Skip setup').click();
    await expect(anyAlert.filter({hasText: NETWORK_ERROR})).toBeVisible();
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 3);
    await expect(anyAlert).toHaveCount(0);
    expect((await currentUser(page)).onboardingCompleted).toBe(false);
  });

  test('the error of a failed finish does not follow the user to another step with the browser Back button either', async ({page}) => {
    await installFaultInjection(page);
    await startOnboarding(page, 3);

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 0}]);
    await button(page, 'Skip for now').click();
    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();

    await page.goBack();

    await expectOnboardingStep(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

// QA-029: "Skip setup" used to race with a request that was still on its way; the late answer
// brought the user back into the setup, or took them to Google from the dashboard.
test.describe('"Skip setup" waits for a request that is in flight', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
  });

  test('while the voice is being saved "Skip setup" is disabled; afterwards it works and the dashboard stays', async ({page}) => {
    await startOnboarding(page, 2);
    await voice(page, 'Bella').check();
    await setFaults(page, [{method: 'PATCH', path: '/me', hold: true}]);

    await button(page, 'Continue').click();

    await expect(button(page, 'Continue')).toHaveAttribute('aria-busy', 'true');
    await expect(button(page, 'Skip setup')).toBeDisabled();
    await expect(button(page, 'Skip for now')).toBeDisabled();
    await expect(button(page, 'Back')).toBeDisabled();

    await releaseHeldRequests(page);
    await expectOnboardingStep(page, 3);
    await expect(button(page, 'Skip setup')).toBeEnabled();
    await setFaults(page, []);
    await skipSetup(page);

    // Nothing arrives late to undo it.
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    expect(await currentUser(page)).toMatchObject({
      onboardingCompleted: true,
      defaults: {voiceId: VOICES.find((v) => v.name === 'Bella')!.id},
    });
  });

  test('while "Connect YouTube" is waiting for its answer, "Skip setup" and the other ways out are disabled, and the browser then goes to Google', async ({page}) => {
    await startOnboarding(page, 3);
    await setFaults(page, [{method: 'GET', path: '/connections/youtube/connect', hold: true}]);

    await button(page, 'Connect YouTube').click();

    await expect(button(page, 'Connect YouTube')).toHaveAttribute('aria-busy', 'true');
    await expect(button(page, 'Skip setup')).toBeDisabled();
    await expect(button(page, 'Skip for now')).toBeDisabled();
    await expect(button(page, 'Back')).toBeDisabled();
    await expectOnboardingStep(page, 3);

    await releaseHeldRequests(page);
    await expect(page).toHaveURL(/\/mock\/youtube\?state=\w+/);
    await expect(h1(page)).toHaveText('Google (mock)');
    expect((await currentUser(page)).onboardingCompleted).toBe(false);
  });

  test('"Skip setup" itself cannot be pressed twice while it is being saved', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [{method: 'PATCH', path: '/me', hold: true}]);

    await button(page, 'Skip setup').click();

    await expect(button(page, 'Skip setup')).toBeDisabled();
    await expectOnboardingStep(page, 1);

    await releaseHeldRequests(page);
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    expect(await faultHits(page)).toBe(1);
  });
});

// QA-034: skipping a step is not completing it.
test.describe('the stepper says what is really saved', () => {
  test('steps passed with "Skip for now" are shown as skipped, not done; steps not reached show only their number', async ({page}) => {
    await startOnboarding(page, 1);
    await expectSetupStepState(page, 1, 'current');
    await expectSetupStepState(page, 2, 'ahead');
    await expectSetupStepState(page, 3, 'ahead');

    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    await expectSetupStepState(page, 1, 'skipped');
    await expectSetupStepState(page, 2, 'current');
    await expectSetupStepState(page, 3, 'ahead');

    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 3);
    await expectSetupStepState(page, 1, 'skipped');
    await expectSetupStepState(page, 2, 'skipped');
    await expectSetupStepState(page, 3, 'current');
    await expect(setupSteps(page)).not.toContainText('(done)');

    // Going back, the steps after the current one are no longer "passed".
    await button(page, 'Back').click();
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expectSetupStepState(page, 2, 'ahead');
    await expectSetupStepState(page, 3, 'ahead');
  });

  test('a new user who opens step 3 by its address sees steps 1 and 2 as skipped', async ({page}) => {
    await startOnboarding(page, 1);

    await page.goto('/onboarding?step=3');

    await expectOnboardingStep(page, 3);
    await expectSetupStepState(page, 1, 'skipped');
    await expectSetupStepState(page, 2, 'skipped');
  });

  test('a step is shown as done once its choice is saved, and stays done when the user goes back past it', async ({page}) => {
    await startOnboarding(page, 1);

    await topic(page, 'Fitness').click();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    await expectSetupStepState(page, 1, 'done');
    await expectSetupStepState(page, 3, 'ahead');

    // Choosing a voice is not saving it.
    await voice(page, 'Bella').check();
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 3);
    await expectSetupStepState(page, 1, 'done');
    await expectSetupStepState(page, 2, 'skipped');

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await voice(page, 'Bella').check();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 3);
    await expectSetupStepState(page, 1, 'done');
    await expectSetupStepState(page, 2, 'done');
    await expectSetupStepState(page, 3, 'current');

    // Back on step 1: the voice is saved, so step 2 is done although it comes later.
    await button(page, 'Back').click();
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expectSetupStepState(page, 1, 'current');
    await expectSetupStepState(page, 2, 'done');
    await expectSetupStepState(page, 3, 'ahead');

    // The same after a reload: it comes from what is saved, not from what was clicked.
    await page.reload();
    await expectOnboardingStep(page, 1);
    await expectSetupStepState(page, 2, 'done');
    await expectSetupStepState(page, 3, 'ahead');
  });

  test('a connected YouTube channel shows step 3 as done from the other steps', async ({page}) => {
    await startOnboarding(page, 3);
    await button(page, 'Connect YouTube').click();
    await expect(h1(page)).toHaveText('Google (mock)');
    await page.getByRole('button', {name: 'Allow', exact: true}).click();
    await expectOnboardingStep(page, 3, 'YouTube connected');
    await expectSetupStepState(page, 3, 'current');

    await button(page, 'Back').click();

    await expectOnboardingStep(page, 2);
    await expectSetupStepState(page, 1, 'skipped');
    await expectSetupStepState(page, 3, 'done');
  });
});

// QA-037: a keyboard or screen-reader user must notice that the step changed, and each step has its own page title.
test.describe('focus and page title', () => {
  const stepHeadingHasFocus = (page: Page) => expect(h1(page)).toBeFocused();

  test('moving to another step puts focus on its heading, and the next Tab goes into the step', async ({page}) => {
    await startOnboarding(page, 1);
    // Arriving on the setup is a page change of its own; the heading is not focused then.
    await expect(h1(page)).not.toBeFocused();

    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    await stepHeadingHasFocus(page);
    await expect(voiceRadios(page)).toHaveCount(6);
    // From the heading, Tab reaches the step's first control, not "Skip setup" at the top of the page.
    await page.keyboard.press('Tab');
    await expect(playSample(page, VOICE_NAMES[0])).toBeFocused();

    await voice(page, 'Bella').check();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 3);
    await stepHeadingHasFocus(page);
    await page.keyboard.press('Tab');
    // The YouTube step's first control is Back (no guide link since F7).
    await expect(button(page, 'Back')).toBeFocused();

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await stepHeadingHasFocus(page);

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await stepHeadingHasFocus(page);
    await page.keyboard.press('Tab');
    await expect(topic(page, 'Fitness')).toBeFocused();

    // Saving with Enter from the text field moves focus as well.
    await somethingElse(page).fill('gardening');
    await somethingElse(page).press('Enter');
    await expectOnboardingStep(page, 2);
    await stepHeadingHasFocus(page);
  });

  // BUG-019/020: the browser's Back and Forward buttons change the step like the page's own buttons do.
  test('the browser Back and Forward buttons put focus on the heading of the step they lead to', async ({page}) => {
    await startOnboarding(page, 3);
    // Focus is somewhere else on the page before the browser button is used.
    await button(page, 'Skip setup').focus();
    await expect(h1(page)).not.toBeFocused();

    await page.goBack();
    await expectOnboardingStep(page, 2);
    await stepHeadingHasFocus(page);
    await expect(voiceRadios(page)).toHaveCount(6);
    await page.keyboard.press('Tab');
    await expect(playSample(page, VOICE_NAMES[0])).toBeFocused();

    await page.goBack();
    await expectOnboardingStep(page, 1);
    await stepHeadingHasFocus(page);
    await page.keyboard.press('Tab');
    await expect(topic(page, 'Fitness')).toBeFocused();

    await page.goForward();
    await expectOnboardingStep(page, 2);
    await stepHeadingHasFocus(page);

    await page.goForward();
    await expectOnboardingStep(page, 3);
    await stepHeadingHasFocus(page);
  });

  test('after a reload, the browser Back button still puts focus on the heading of the step it leads to', async ({page}) => {
    await startOnboarding(page, 2);
    await page.reload();
    await expectOnboardingStep(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(h1(page)).not.toBeFocused();

    await page.goBack();

    await expectOnboardingStep(page, 1);
    await stepHeadingHasFocus(page);
  });

  test('opening a step by its address does not move focus to the heading', async ({page}) => {
    await startOnboarding(page, 1);

    for (const step of [2, 3, 1] as OnboardingStep[]) {
      await page.goto(`/onboarding?step=${step}`);
      await expectOnboardingStep(page, step);
      await expect(h1(page), `step ${step}`).not.toBeFocused();
    }
  });

  test('reloading a step that was reached from another step does not move focus to the heading', async ({page}) => {
    await startOnboarding(page, 2);
    await expect(h1(page)).toBeFocused();

    await page.reload();

    await expectOnboardingStep(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(h1(page)).not.toBeFocused();
  });

  test('the page title names the step during the setup and is "ReelForge" afterwards', async ({page}) => {
    await startOnboarding(page, 1);
    await expect(page).toHaveTitle(onboardingTitle(1));

    await button(page, 'Skip for now').click();
    await expect(page).toHaveTitle(onboardingTitle(2));
    await button(page, 'Skip for now').click();
    await expect(page).toHaveTitle(onboardingTitle(3));
    await button(page, 'Back').click();
    await expect(page).toHaveTitle(onboardingTitle(2));

    await page.reload();
    await expectOnboardingStep(page, 2);
    await expect(page).toHaveTitle(onboardingTitle(2));
    await page.goto('/onboarding?step=3');
    await expect(page).toHaveTitle(onboardingTitle(3));

    await skipSetup(page);
    await expect(page).toHaveTitle('ReelForge');
  });
});

test.describe('step 1: niche', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
    await startOnboarding(page);
  });

  test('offers 12 topics; a topic can be selected and deselected, and Continue needs at least one choice', async ({page}) => {
    await expect(topics(page)).toHaveCount(12);
    await expect(page.getByText('Pick up to 3.')).toBeVisible();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {pressed: true})).toHaveCount(0);
    await expect(chosenCount(page, 0)).toBeVisible();
    await expect(button(page, 'Continue')).toBeDisabled();

    await topic(page, 'Fitness').click();
    await expect(topic(page, 'Fitness')).toHaveAttribute('aria-pressed', 'true');
    await expect(chosenCount(page, 1)).toBeVisible();
    await expect(button(page, 'Continue')).toBeEnabled();

    await topic(page, 'Fitness').click();
    await expect(topic(page, 'Fitness')).toHaveAttribute('aria-pressed', 'false');
    await expect(chosenCount(page, 0)).toBeVisible();
    await expect(button(page, 'Continue')).toBeDisabled();

    // The free text counts as a choice; spaces alone do not.
    await somethingElse(page).fill('   ');
    await expect(button(page, 'Continue')).toBeDisabled();
    await somethingElse(page).fill('gardening');
    await expect(chosenCount(page, 1)).toBeVisible();
    await expect(button(page, 'Continue')).toBeEnabled();
  });

  test('with 3 topics chosen, the other topics and the text field are disabled until one is deselected', async ({page}) => {
    for (const name of ['Fitness', 'Finance', 'Tech']) await topic(page, name).click();

    await expect(chosenCount(page, 3)).toBeVisible();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {pressed: true})).toHaveCount(3);
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {disabled: true})).toHaveCount(9);
    await expect(topic(page, 'Food')).toBeDisabled();
    await expect(somethingElse(page)).toBeDisabled();
    for (const name of ['Fitness', 'Finance', 'Tech']) await expect(topic(page, name)).toBeEnabled();

    await topic(page, 'Finance').click();

    await expect(chosenCount(page, 2)).toBeVisible();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {disabled: true})).toHaveCount(0);
    await expect(somethingElse(page)).toBeEnabled();
    await topic(page, 'Food').click();
    await expect(topic(page, 'Food')).toHaveAttribute('aria-pressed', 'true');
    await expect(chosenCount(page, 3)).toBeVisible();
  });

  test('the free text counts towards the limit of 3', async ({page}) => {
    await topic(page, 'Travel').click();
    await topic(page, 'Food').click();
    await somethingElse(page).fill('gardening');

    await expect(chosenCount(page, 3)).toBeVisible();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {disabled: true})).toHaveCount(10);
    await expect(topic(page, 'Fitness')).toBeDisabled();
    // The text itself can still be edited, and the chosen topics can still be deselected.
    await expect(somethingElse(page)).toBeEnabled();
    await expect(topic(page, 'Travel')).toBeEnabled();

    await somethingElse(page).fill('');

    await expect(chosenCount(page, 2)).toBeVisible();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {disabled: true})).toHaveCount(0);
  });

  test('Continue saves the choices as one comma-separated value; they are shown again after Back and after a reload', async ({page}) => {
    await topic(page, 'Fitness').click();
    await topic(page, 'Finance').click();
    await somethingElse(page).fill('gardening');

    await button(page, 'Continue').click();

    await expectOnboardingStep(page, 2);
    // The example in API_DESIGN.md A10.
    expect((await currentUser(page)).niche).toBe('Fitness, Finance, gardening');

    const expectSavedChoices = async () => {
      await expectOnboardingStep(page, 1);
      await expect(topic(page, 'Fitness')).toHaveAttribute('aria-pressed', 'true');
      await expect(topic(page, 'Finance')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {pressed: true})).toHaveCount(2);
      await expect(somethingElse(page)).toHaveValue('gardening');
      await expect(chosenCount(page, 3)).toBeVisible();
    };
    await button(page, 'Back').click();
    await expectSavedChoices();
    await page.reload();
    await expectSavedChoices();
  });

  test('a saved choice can be changed: Continue replaces what was saved before', async ({page}) => {
    await topic(page, 'Fitness').click();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);

    await topic(page, 'Fitness').click();
    await topic(page, 'Comedy').click();
    await button(page, 'Continue').click();

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Comedy');
  });

  // API_DESIGN.md A10: "at most three topics separated by commas ... plus at most one free-text topic
  // of up to 40 characters that cannot itself contain a comma".
  test('the free text is one topic: commas and tabs put into it become spaces, and it counts once', async ({page}) => {
    await topic(page, 'Fitness').click();
    await topic(page, 'Finance').click();

    await somethingElse(page).fill('knitting, pottery,chess\torigami');

    await expect(somethingElse(page)).toHaveValue('knitting pottery chess origami');
    await expect(chosenCount(page, 3)).toBeVisible();

    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Fitness, Finance, knitting pottery chess origami');
  });

  test('a comma typed on the keyboard becomes a space as it is typed', async ({page}) => {
    await somethingElse(page).pressSequentially('home,garden');

    await expect(somethingElse(page)).toHaveValue('home garden');
    await expect(chosenCount(page, 1)).toBeVisible();
  });

  test('the free text is limited to 40 characters, and an emoji at the limit is kept whole or left out, never cut in half', async ({page}) => {
    const seedling = '\u{1F331}';
    const letters39 = 'a'.repeat(39);

    // 39 letters and an emoji are 40 characters: all of it fits, and what follows does not.
    await somethingElse(page).fill(letters39 + seedling + 'zzz');
    await expect(somethingElse(page)).toHaveValue(letters39 + seedling);

    // The emoji as the 41st character is left out whole.
    await somethingElse(page).fill(letters39 + 'b' + seedling);
    await expect(somethingElse(page)).toHaveValue(letters39 + 'b');

    await somethingElse(page).fill(letters39 + seedling + seedling);
    await expect(somethingElse(page)).toHaveValue(letters39 + seedling);
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);

    // What reached the API is the whole emoji, not half of one.
    expect((await currentUser(page)).niche).toBe(letters39 + seedling);
    await button(page, 'Back').click();
    await expect(somethingElse(page)).toHaveValue(letters39 + seedling);
  });

  // The name of a selected topic adds nothing. The field is emptied when the user leaves it, not
  // while they type (BUG-018: clearing while typing made "Tech reviews" impossible to type).
  test('the name of a topic that is already selected stays in the free text while typing, counts once, and is cleared when the field is left', async ({page}) => {
    await topic(page, 'Fitness').click();
    await expect(chosenCount(page, 1)).toBeVisible();

    // A leading space is never kept in the field (see cleanCustom), so ' FITNESS ' reads 'FITNESS '.
    const cases: [string, string][] = [
      ['Fitness', 'Fitness'],
      ['fitness', 'fitness'],
      [' FITNESS ', 'FITNESS '],
    ];
    for (const [text, shown] of cases) {
      await somethingElse(page).fill(text);

      // Still in the field, and still one topic, not two.
      await expect(somethingElse(page), text).toBeFocused();
      await expect(somethingElse(page), text).toHaveValue(shown);
      await expect(chosenCount(page, 1)).toBeVisible();

      await somethingElse(page).blur();

      await expect(somethingElse(page), `${text}, after leaving the field`).toHaveValue('');
      await expect(chosenCount(page, 1)).toBeVisible();
    }

    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Fitness');
  });

  test('the name of a selected topic that is still in the free text does not use up a choice and is not stored twice', async ({page}) => {
    await topic(page, 'Fitness').click();
    await topic(page, 'Tech').click();
    await somethingElse(page).pressSequentially('fitness');

    // Two topics, not three: a third can still be chosen.
    await expect(somethingElse(page)).toHaveValue('fitness');
    await expect(chosenCount(page, 2)).toBeVisible();
    await expect(topic(page, 'Food')).toBeEnabled();

    // Enter saves from inside the field, so the text is still there when the value is built.
    await somethingElse(page).press('Enter');

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Fitness, Tech');
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expect(somethingElse(page)).toHaveValue('');
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {pressed: true})).toHaveCount(2);
    await expect(chosenCount(page, 2)).toBeVisible();
  });

  test('leaving the free text with the Tab key clears the name of a selected topic, and only that', async ({page}) => {
    await topic(page, 'Tech').click();

    // The name of a listed topic that is not selected is a choice of its own and stays.
    await somethingElse(page).pressSequentially('gaming');
    await page.keyboard.press('Tab');
    await expect(somethingElse(page)).not.toBeFocused();
    await expect(somethingElse(page)).toHaveValue('gaming');
    await expect(chosenCount(page, 2)).toBeVisible();

    await somethingElse(page).fill('tech');
    await expect(somethingElse(page)).toHaveValue('tech');
    await page.keyboard.press('Tab');
    await expect(somethingElse(page)).not.toBeFocused();
    await expect(somethingElse(page)).toHaveValue('');
    await expect(chosenCount(page, 1)).toBeVisible();
  });

  test('a free text that names a listed topic which is not selected is stored as that topic', async ({page}) => {
    await topic(page, 'Tech').click();
    await somethingElse(page).fill('gaming');
    await expect(chosenCount(page, 2)).toBeVisible();

    await button(page, 'Continue').click();

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Tech, Gaming');
    // On return it is the listed topic that is lit, not a free text.
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expect(topic(page, 'Gaming')).toHaveAttribute('aria-pressed', 'true');
    await expect(topic(page, 'Tech')).toHaveAttribute('aria-pressed', 'true');
    await expect(somethingElse(page)).toHaveValue('');
    await expect(chosenCount(page, 2)).toBeVisible();
  });

  // A10 allows a free-text topic of the user's own next to the listed ones. "Tech reviews" is such a
  // topic, and it is not the listed topic "Tech", whether or not "Tech" is selected.
  test('a free text that only begins with the name of a selected topic can be typed in full', async ({page}) => {
    await topic(page, 'Tech').click();

    await somethingElse(page).pressSequentially('Tech reviews');

    await expect(somethingElse(page)).toHaveValue('Tech reviews');
    await expect(chosenCount(page, 2)).toBeVisible();
    // Leaving the field keeps it: it is not the name of the selected topic.
    await somethingElse(page).blur();
    await expect(somethingElse(page)).toHaveValue('Tech reviews');
    await expect(chosenCount(page, 2)).toBeVisible();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Tech, Tech reviews');
  });

  test('a saved niche can be cleared: deselect everything and Continue saves an empty niche', async ({page}) => {
    await topic(page, 'Fitness').click();
    await somethingElse(page).fill('gardening');
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Fitness, gardening');
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);

    await topic(page, 'Fitness').click();
    await somethingElse(page).fill('');
    await expect(chosenCount(page, 0)).toBeVisible();
    // Nothing is chosen, but there is a saved niche to clear.
    await expect(button(page, 'Continue')).toBeEnabled();
    await button(page, 'Continue').click();

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('');
    await expectSetupStepState(page, 1, 'skipped');

    // With nothing saved any more, Continue needs a choice again.
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expect(chosenCount(page, 0)).toBeVisible();
    await expect(button(page, 'Continue')).toBeDisabled();
  });

  test('"Skip for now" with everything deselected does not clear the saved niche', async ({page}) => {
    await topic(page, 'Fitness').click();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);

    await topic(page, 'Fitness').click();
    await expect(chosenCount(page, 0)).toBeVisible();
    await button(page, 'Skip for now').click();

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('Fitness');
  });

  test('Enter in "Something else" continues, and does nothing while there is nothing to save', async ({page}) => {
    // Lets every save through and counts them.
    await setFaults(page, [{method: 'PATCH', path: '/me'}]);

    await somethingElse(page).focus();
    await page.keyboard.press('Enter');
    await somethingElse(page).pressSequentially('gardening');
    await expect(chosenCount(page, 1)).toBeVisible();
    // The first Enter, with nothing chosen, saved nothing and went nowhere.
    await expectOnboardingStep(page, 1);
    expect(await faultHits(page)).toBe(0);

    await page.keyboard.press('Enter');

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('gardening');
    expect(await faultHits(page)).toBe(1);
  });

  test('while a save is in flight the topics, the text field and every way out are disabled, and the choices are saved as they were', async ({page}) => {
    await topic(page, 'Fitness').click();
    await somethingElse(page).fill('gardening');
    await setFaults(page, [{method: 'PATCH', path: '/me', hold: true}]);

    await button(page, 'Continue').click();

    await expect(button(page, 'Continue')).toHaveAttribute('aria-busy', 'true');
    await expect(button(page, 'Continue')).toBeDisabled();
    await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {disabled: true})).toHaveCount(12);
    await expect(topic(page, 'Fitness')).toBeDisabled();
    await expect(topic(page, 'Fitness')).toHaveAttribute('aria-pressed', 'true');
    await expect(somethingElse(page)).toBeDisabled();
    await expect(somethingElse(page)).toHaveValue('gardening');
    await expect(button(page, 'Skip for now')).toBeDisabled();
    await expect(button(page, 'Skip setup')).toBeDisabled();
    await expectOnboardingStep(page, 1);
    expect((await currentUser(page)).niche).toBe('');

    // Once the request is answered, the step moves on.
    await releaseHeldRequests(page);
    await expectOnboardingStep(page, 2);
    await expect(button(page, 'Skip setup')).toBeEnabled();
    expect(await faultHits(page)).toBe(1);
    expect(await currentUser(page)).toMatchObject({niche: 'Fitness, gardening', onboardingCompleted: false});
  });

  // Settings (F8) or another client can leave a value that the step's own rules would not produce.
  for (const {name, stored, pressed, freeText, count, saved} of [
    {
      name: 'four topics',
      stored: 'Fitness, Finance, Tech, Food',
      pressed: ['Fitness', 'Finance', 'Tech'],
      freeText: '',
      count: 3,
      saved: 'Fitness, Finance, Tech',
    },
    {name: 'a topic twice', stored: 'Fitness, Fitness', pressed: ['Fitness'], freeText: '', count: 1, saved: 'Fitness'},
    {
      name: 'several free-text topics',
      stored: 'knitting, pottery, chess, origami',
      pressed: [],
      freeText: 'knitting',
      count: 1,
      saved: 'knitting',
    },
    {name: 'a free text of 120 characters', stored: 'x'.repeat(120), pressed: [], freeText: 'x'.repeat(40), count: 1, saved: 'x'.repeat(40)},
  ]) {
    test(`a niche already in the profile that breaks the rules (${name}) is shown within them, and Continue saves it that way`, async ({page}) => {
      await patchProfile(page, {niche: stored});
      await page.reload();
      await expectOnboardingStep(page, 1);

      await expect(chosenCount(page, count)).toBeVisible();
      await expect(page.getByRole('group', {name: 'Topics'}).getByRole('button', {pressed: true})).toHaveCount(pressed.length);
      for (const label of pressed) await expect(topic(page, label)).toHaveAttribute('aria-pressed', 'true');
      await expect(somethingElse(page)).toHaveValue(freeText);
      if (count === 3) await expect(topic(page, 'Food')).toBeDisabled();
      // Looking at the step changes nothing by itself.
      expect((await currentUser(page)).niche).toBe(stored);

      await button(page, 'Continue').click();

      await expectOnboardingStep(page, 2);
      expect((await currentUser(page)).niche).toBe(saved);
    });
  }

  test('"Skip for now" moves on without saving the choices', async ({page}) => {
    await topic(page, 'Tech').click();
    await somethingElse(page).fill('gardening');

    await button(page, 'Skip for now').click();

    await expectOnboardingStep(page, 2);
    expect((await currentUser(page)).niche).toBe('');
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    await expect(topic(page, 'Tech')).toHaveAttribute('aria-pressed', 'false');
    await expect(somethingElse(page)).toHaveValue('');
    await expect(chosenCount(page, 0)).toBeVisible();
  });

  test('when Continue cannot save, an error is shown, the user stays on the step with their choices, and a retry works', async ({page}) => {
    await topic(page, 'Gaming').click();

    await setFaults(page, [failPatchMe]);
    await button(page, 'Continue').click();

    await expect(page.getByRole('alert').filter({hasText: SAVE_FAILED})).toBeVisible();
    await expectOnboardingStep(page, 1);
    await expect(topic(page, 'Gaming')).toHaveAttribute('aria-pressed', 'true');
    await expect(button(page, 'Continue')).toBeEnabled();

    await setFaults(page, [{method: 'PATCH', path: '/me', status: 0}]);
    await button(page, 'Continue').click();
    await expect(page.getByRole('alert').filter({hasText: NETWORK_ERROR})).toBeVisible();
    await expectOnboardingStep(page, 1);
    expect((await currentUser(page)).niche).toBe('');

    await setFaults(page, []);
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await currentUser(page)).niche).toBe('Gaming');
  });
});

/** A silent WAV file of the given length, as a data URL: a voice sample long enough to observe while it plays. */
function silentSample(seconds: number): string {
  const rate = 4000;
  const samples = rate * seconds;
  const bytes = new Uint8Array(44 + samples).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Makes GET /voices answer with the usual voices, the first two with a sample of the given length. */
function voicesWithSamplesOf(seconds: number) {
  const sample = silentSample(seconds);
  const items = VOICES.map((v, i) => (i < 2 ? {...v, previewUrl: sample} : v));
  return {method: 'GET', path: '/voices', status: 200, body: {items}} as const;
}

type AudioWindow = Window & {__rfAudios: HTMLAudioElement[]};

/** Records every audio player the page creates, so a test can tell what is audible. Call before the first page.goto. */
async function trackAudio(page: Page) {
  await page.addInitScript(() => {
    const RealAudio = window.Audio;
    const made: HTMLAudioElement[] = [];
    (window as unknown as AudioWindow).__rfAudios = made;
    window.Audio = function (src?: string) {
      const audio = new RealAudio(src);
      made.push(audio);
      return audio;
    } as unknown as typeof Audio;
  });
}

/** How many samples are audible right now. */
const samplesPlaying = (page: Page) =>
  page.evaluate(() => (window as unknown as AudioWindow).__rfAudios.filter((a) => !a.paused && !a.ended).length);

test.describe('step 2: voice', () => {
  test.beforeEach(async ({page}) => {
    await installFaultInjection(page);
    await trackAudio(page);
  });

  test('shows the six voices with their style, none chosen yet, and Continue needs a choice', async ({page}) => {
    await startOnboarding(page, 2);

    await expect(voiceRadios(page)).toHaveCount(6);
    for (const v of VOICES) {
      await expect(voice(page, v.name)).not.toBeChecked();
      await expect(page.getByRole('radio', {name: new RegExp(`^${v.name}\\b.*${v.style}.*${v.gender}`)})).toHaveCount(1);
      await expect(playSample(page, v.name)).toBeVisible();
    }
    await expect(button(page, 'Continue')).toBeDisabled();
    await expect(button(page, 'Skip for now')).toBeEnabled();
  });

  test('one voice is selected at a time; Continue saves it as the default voice and it is shown again after Back and a reload', async ({page}) => {
    await startOnboarding(page, 2);
    const before = (await currentUser(page)).defaults;

    await voice(page, 'Bella').check();
    await expect(voice(page, 'Bella')).toBeChecked();
    await voice(page, 'Adam').check();
    await expect(voice(page, 'Adam')).toBeChecked();
    await expect(voice(page, 'Bella')).not.toBeChecked();
    await expect(page.getByRole('radio', {checked: true})).toHaveCount(1);

    await button(page, 'Continue').click();

    await expectOnboardingStep(page, 3);
    // Only the voice changes; the other defaults are untouched (A10: all fields optional).
    expect((await currentUser(page)).defaults).toEqual({...before, voiceId: VOICES.find((v) => v.name === 'Adam')!.id});

    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await expect(voice(page, 'Adam')).toBeChecked();
    await page.reload();
    await expectOnboardingStep(page, 2);
    await expect(voice(page, 'Adam')).toBeChecked();
    await expect(page.getByRole('radio', {checked: true})).toHaveCount(1);
  });

  test('a voice can be chosen with the keyboard: Tab to the group, Space, then the arrow keys', async ({page}) => {
    await startOnboarding(page, 2);
    await expect(voiceRadios(page)).toHaveCount(6);

    await tabTo(page, voice(page, VOICE_NAMES[0]));
    await page.keyboard.press('Space');
    await expect(voice(page, VOICE_NAMES[0])).toBeChecked();

    await page.keyboard.press('ArrowDown');
    await expect(voice(page, VOICE_NAMES[1])).toBeChecked();
    await expect(voice(page, VOICE_NAMES[1])).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(voice(page, VOICE_NAMES[2])).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(voice(page, VOICE_NAMES[1])).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(voice(page, VOICE_NAMES[0])).toBeChecked();
    await expect(page.getByRole('radio', {checked: true})).toHaveCount(1);

    await tabTo(page, button(page, 'Continue'));
    await page.keyboard.press('Enter');

    await expectOnboardingStep(page, 3);
    expect((await currentUser(page)).defaults.voiceId).toBe(VOICES[0].id);
  });

  test('"Skip for now" and Back leave the step without saving the chosen voice', async ({page}) => {
    await startOnboarding(page, 2);
    await voice(page, 'Josh').check();

    await button(page, 'Skip for now').click();

    await expectOnboardingStep(page, 3);
    expect((await currentUser(page)).defaults.voiceId).toBe('');
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('radio', {checked: true})).toHaveCount(0);

    await voice(page, 'Elli').check();
    await button(page, 'Back').click();
    await expectOnboardingStep(page, 1);
    expect((await currentUser(page)).defaults.voiceId).toBe('');
  });

  test("the mock samples really play: a sample runs to its end and no playback error is shown", async ({page}) => {
    await startOnboarding(page, 2);
    const name = VOICE_NAMES[0];

    await playSample(page, name).click();

    // The mock sample is under a second long, so wait for its end rather than for the short "Stop" state.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as AudioWindow).__rfAudios.map((a) => ({ended: a.ended, error: a.error?.code ?? null}))))
      .toEqual([{ended: true, error: null}]);
    await expect(playSample(page, name)).toBeVisible();
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
  });

  test('Play turns into Stop while the sample plays, and back into Play when the sample ends', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [voicesWithSamplesOf(3)]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    const name = VOICE_NAMES[0];

    await playSample(page, name).click();

    await expect(stopSample(page, name)).toBeVisible();
    await expect(playSample(page, name)).toHaveCount(0);
    await expect.poll(() => samplesPlaying(page)).toBe(1);

    // Nothing is pressed: after three seconds the sample ends by itself.
    await expect(playSample(page, name)).toBeVisible();
    await expect(stopSample(page, name)).toHaveCount(0);
    expect(await samplesPlaying(page)).toBe(0);
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
    // Playing a sample does not select the voice.
    await expect(page.getByRole('radio', {checked: true})).toHaveCount(0);
  });

  test('only one sample plays at a time, Stop silences it, and leaving the step silences it too', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [voicesWithSamplesOf(15)]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    const [first, second] = VOICE_NAMES;

    await playSample(page, first).click();
    await expect(stopSample(page, first)).toBeVisible();
    await expect.poll(() => samplesPlaying(page)).toBe(1);

    // Starting the second sample stops the first.
    await playSample(page, second).click();
    await expect(stopSample(page, second)).toBeVisible();
    await expect(playSample(page, first)).toBeVisible();
    await expect(page.getByRole('button', {name: /^Stop .* sample$/})).toHaveCount(1);
    await expect.poll(() => samplesPlaying(page)).toBe(1);

    await stopSample(page, second).click();
    await expect(playSample(page, second)).toBeVisible();
    await expect(page.getByRole('button', {name: /^Stop .* sample$/})).toHaveCount(0);
    await expect.poll(() => samplesPlaying(page)).toBe(0);

    // Still playing when the user moves on: the sound must not carry over to the next step.
    await playSample(page, first).click();
    await expect(stopSample(page, first)).toBeVisible();
    await expect.poll(() => samplesPlaying(page)).toBe(1);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 3);
    await expect.poll(() => samplesPlaying(page)).toBe(0);
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
  });

  // With real voice samples a sample takes a moment to load. Switching to another voice (or pressing
  // Stop) before the first one has started is not a playback failure and must not be reported as one.
  test('switching to another sample before the first has started does not show a playback error', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [voicesWithSamplesOf(15)]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    const [first, second] = VOICE_NAMES;
    await expect(playSample(page, second)).toBeVisible();

    // Both presses in the same instant, which no pointer can do against a local data URL but any
    // user does against a sample that is still downloading.
    await page.getByRole('button', {name: /^Play .* sample$/}).evaluateAll((buttons) => {
      (buttons[0] as HTMLButtonElement).click();
      (buttons[1] as HTMLButtonElement).click();
    });

    await expect(stopSample(page, second)).toBeVisible();
    await expect.poll(() => samplesPlaying(page)).toBe(1);
    await expect(playSample(page, first)).toBeVisible();
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
  });

  test('pressing Stop before the sample has started does not show a playback error', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [voicesWithSamplesOf(15)]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);
    const [first, second] = VOICE_NAMES;
    await expect(playSample(page, first)).toBeVisible();

    // Play, then Stop as soon as the page has drawn the Stop button: sooner than a sample can start.
    await page.getByRole('button', {name: /^Play .* sample$/}).first().evaluate(async (el) => {
      (el as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      (el as HTMLButtonElement).click();
    });

    await expect(playSample(page, first)).toBeVisible();
    await expect(page.getByRole('button', {name: /^Stop .* sample$/})).toHaveCount(0);
    await expect.poll(() => samplesPlaying(page)).toBe(0);
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);

    // The voice can still be played afterwards, and a real double click (two presses a moment apart) is fine too.
    await playSample(page, second).dblclick();
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
    await playSample(page, first).click();
    await expect(stopSample(page, first)).toBeVisible();
    await expect.poll(() => samplesPlaying(page)).toBe(1);
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
  });

  // The message is still there for a sample that really cannot be played.
  test('a sample that cannot be played shows "Couldn\'t play this sample." under that voice only', async ({page}) => {
    await startOnboarding(page, 1);
    const items = VOICES.map((v, i) => (i === 0 ? {...v, previewUrl: 'data:audio/wav;base64,AAAA'} : v));
    await setFaults(page, [{method: 'GET', path: '/voices', status: 200, body: {items}}]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);

    await playSample(page, VOICE_NAMES[0]).click();

    await expect(page.getByRole('alert').filter({hasText: "Couldn't play this sample."})).toHaveCount(1);
    await expect(playSample(page, VOICE_NAMES[0])).toBeVisible();

    // Starting a working sample clears it.
    await playSample(page, VOICE_NAMES[1]).click();
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
  });

  test('shows a loading state while the voices are being fetched', async ({page}) => {
    await startOnboarding(page, 1);
    // The request is kept back until the test lets it go, so a slow machine cannot let the voices
    // arrive before the loading state has been checked.
    await setFaults(page, [{method: 'GET', path: '/voices', hold: true}]);

    await button(page, 'Skip for now').click();

    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('status', {name: 'Loading voices'})).toBeVisible();
    await expect(voiceRadios(page)).toHaveCount(0);
    // Leaving is possible while it loads.
    await expect(button(page, 'Back')).toBeEnabled();
    await expect(button(page, 'Skip for now')).toBeEnabled();

    await releaseHeldRequests(page);

    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(page.getByRole('status', {name: 'Loading voices'})).toHaveCount(0);
  });

  test('when the voices cannot be loaded, an error with a working "Try again" is shown, and the step can still be skipped', async ({page}) => {
    await startOnboarding(page, 1);
    await setFaults(page, [{method: 'GET', path: '/voices', status: 500}]);
    await button(page, 'Skip for now').click();
    await expectOnboardingStep(page, 2);

    const error = page.getByRole('alert').filter({hasText: "We couldn't load the voices."});
    await expect(error).toBeVisible({timeout: 20_000});
    await expect(voiceRadios(page)).toHaveCount(0);
    await expect(button(page, 'Continue')).toBeDisabled();
    await expect(button(page, 'Skip for now')).toBeEnabled();
    await expect(button(page, 'Back')).toBeEnabled();

    await setFaults(page, []);
    await error.getByRole('button', {name: 'Try again'}).click();

    await expect(voiceRadios(page)).toHaveCount(6);
    await expect(error).toHaveCount(0);
    await voice(page, 'Antoni').check();
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 3);
  });

  test('when Continue cannot save, an error is shown, the user stays on the step with the voice still chosen, and a retry works', async ({page}) => {
    await startOnboarding(page, 2);
    await voice(page, 'Elli').check();

    await setFaults(page, [failPatchMe]);
    await button(page, 'Continue').click();

    await expect(page.getByRole('alert').filter({hasText: SAVE_FAILED})).toBeVisible();
    await expectOnboardingStep(page, 2);
    await expect(voice(page, 'Elli')).toBeChecked();
    expect((await currentUser(page)).defaults.voiceId).toBe('');

    await setFaults(page, []);
    await button(page, 'Continue').click();
    await expectOnboardingStep(page, 3);
    expect((await currentUser(page)).defaults.voiceId).toBe(VOICES.find((v) => v.name === 'Elli')!.id);
  });
});

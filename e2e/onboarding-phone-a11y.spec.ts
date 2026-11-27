import {expect, test, type Locator, type Page} from '@playwright/test';
import {listVoices} from '../src/mocks/db';
import {
  controlsWithoutAName,
  currentSetupStep,
  currentUser,
  expectOnboardingStep,
  expectSetupStepState,
  fitsViewportWidth,
  h1,
  installFaultInjection,
  nestedInteractiveControls,
  ONBOARDING_STEPS,
  setFaults,
  setupSteps,
  startOnboarding,
  tabTo,
  type OnboardingStep,
} from './helpers';

// F4 onboarding at phone width (PRD section 12: the web app works in a phone browser) and
// accessibility basics on each step: one h1, named controls, the current step exposed, keyboard use.

const PHONE = {width: 390, height: 844};
// The narrowest phone still in use (QA-038).
const SMALL_PHONE = {width: 320, height: 568};
const VOICE_NAMES = listVoices().map((v) => v.name);
// YouTube channel names are at most 100 characters; a long one must still fit the screen.
const LONG_CHANNEL = 'Asha Shorts '.padEnd(60, 'x');

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const topic = (page: Page, name: string) => page.getByRole('group', {name: 'Topics'}).getByRole('button', {name, exact: true});
const voice = (page: Page, name: string) => page.getByRole('radio', {name: new RegExp(`^${name}\\b`)});

/** The control is fully inside the screen's width and a tap on it would land on it (nothing covers it). */
async function expectReachable(control: Locator, label: string) {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  expect(box.x, `${label} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} ends on screen`).toBeLessThanOrEqual(control.page().viewportSize()!.width);
  await control.click({trial: true});
}

/** Which step names the stepper shows. Below 400 px only the current step is named; from 400 px all are. */
async function expectStepNames(page: Page, current: OnboardingStep, othersVisible: boolean) {
  for (const step of [1, 2, 3] as OnboardingStep[]) {
    const name = setupSteps(page).getByText(ONBOARDING_STEPS[step].label, {exact: true});
    if (step === current || othersVisible) await expect(name, `name of step ${step}`).toBeVisible();
    else await expect(name, `name of step ${step}`).toBeHidden();
  }
  // The numbers (or ticks) of all three steps stay on screen either way.
  await expect(setupSteps(page).getByRole('listitem')).toHaveCount(3);
  for (const item of await setupSteps(page).getByRole('listitem').all()) await expect(item).toBeInViewport();
}

test.describe('onboarding at phone width (390x844)', () => {
  test.use({viewport: PHONE, hasTouch: true});

  test('all three steps fit the screen and can be completed by touch', async ({page}) => {
    // The longest flow in the suite: nine page loads in one test. Give it room when the dev server is busy.
    test.slow();
    await startOnboarding(page);

    // Step 1
    expect(await fitsViewportWidth(page), 'step 1: no sideways scrolling').toBe(true);
    await expect(setupSteps(page)).toBeInViewport();
    await expectStepNames(page, 1, false);
    for (const name of ['Skip setup', 'Skip for now']) await expectReachable(button(page, name), name);
    for (const name of ['Fitness', 'Lifestyle']) await expectReachable(topic(page, name), name);
    await expectReachable(page.getByLabel('Something else'), 'Something else');
    await topic(page, 'Fitness').tap();
    await page.getByLabel('Something else').fill('a'.repeat(40));
    expect(await fitsViewportWidth(page), 'step 1 with a long free text').toBe(true);
    await expectReachable(button(page, 'Continue'), 'Continue');
    await button(page, 'Continue').tap();

    // Step 2
    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('radio')).toHaveCount(6);
    expect(await fitsViewportWidth(page), 'step 2: no sideways scrolling').toBe(true);
    for (const name of VOICE_NAMES) {
      await expectReachable(button(page, `Play ${name} sample`), `Play ${name}`);
      await expectReachable(voice(page, name), name);
    }
    for (const name of ['Skip setup', 'Back', 'Skip for now']) await expectReachable(button(page, name), name);
    await voice(page, VOICE_NAMES[5]).tap();
    await expect(voice(page, VOICE_NAMES[5])).toBeChecked();
    await expectReachable(button(page, 'Continue'), 'Continue');
    await button(page, 'Continue').tap();

    // Step 3
    await expectOnboardingStep(page, 3);
    expect(await fitsViewportWidth(page), 'step 3: no sideways scrolling').toBe(true);
    for (const name of ['Skip setup', 'Back', 'Skip for now', 'Connect YouTube']) {
      await expectReachable(button(page, name), name);
    }

    // The stand-in Google page, then the connected state.
    await button(page, 'Connect YouTube').tap();
    await expect(h1(page)).toHaveText('Google (mock)');
    expect(await fitsViewportWidth(page), 'stand-in Google page: no sideways scrolling').toBe(true);
    await page.getByLabel('Channel name').fill(LONG_CHANNEL);
    await page.getByRole('button', {name: 'Allow', exact: true}).tap();

    await expectOnboardingStep(page, 3, 'YouTube connected');
    await expect(page.getByText(`Connected as ${LONG_CHANNEL}`, {exact: true})).toBeVisible();
    expect(await fitsViewportWidth(page), 'step 3 connected: no sideways scrolling').toBe(true);
    for (const name of ['Back', 'Finish']) await expectReachable(button(page, name), name);
    await button(page, 'Finish').tap();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    expect(await currentUser(page)).toMatchObject({onboardingCompleted: true, connections: {youtube: {status: 'connected'}}});
  });

  test('step 3 with the longest failure message (no channel, with its link) fits the screen', async ({page}) => {
    await startOnboarding(page, 3);
    await button(page, 'Connect YouTube').tap();
    await expect(h1(page)).toHaveText('Google (mock)');
    await page.getByRole('button', {name: 'This account has no YouTube channel'}).tap();

    await expectOnboardingStep(page, 3);
    await expect(page.getByRole('alert').getByRole('link', {name: 'Create a YouTube channel'})).toBeVisible();
    expect(await fitsViewportWidth(page), 'no sideways scrolling').toBe(true);
    for (const name of ['Skip setup', 'Back', 'Skip for now', 'Try again']) {
      await expectReachable(button(page, name), name);
    }
  });
});

test.describe('onboarding on the smallest phone (320x568)', () => {
  test.use({viewport: SMALL_PHONE, hasTouch: true});

  test('all three steps fit the width, name only the current step in the stepper, and can be completed by touch', async ({page}) => {
    test.slow();
    await startOnboarding(page);

    // Step 1
    expect(await fitsViewportWidth(page), 'step 1: no sideways scrolling').toBe(true);
    await expectStepNames(page, 1, false);
    for (const name of ['Skip setup', 'Skip for now']) await expectReachable(button(page, name), name);
    for (const name of ['Fitness', 'Finance', 'Business', 'Lifestyle']) await expectReachable(topic(page, name), name);
    await expectReachable(page.getByLabel('Something else'), 'Something else');
    await topic(page, 'Motivation').tap();
    await topic(page, 'Education').tap();
    await page.getByLabel('Something else').fill('W'.repeat(40));
    await expect(page.getByText('3 of 3 chosen')).toBeVisible();
    expect(await fitsViewportWidth(page), 'step 1 with the longest choices').toBe(true);
    await expectReachable(button(page, 'Continue'), 'Continue');
    await button(page, 'Continue').tap();

    // Step 2
    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('radio')).toHaveCount(6);
    expect(await fitsViewportWidth(page), 'step 2: no sideways scrolling').toBe(true);
    await expectStepNames(page, 2, false);
    for (const name of VOICE_NAMES) {
      await expectReachable(button(page, `Play ${name} sample`), `Play ${name}`);
      await expectReachable(voice(page, name), name);
    }
    for (const name of ['Skip setup', 'Back', 'Skip for now']) await expectReachable(button(page, name), name);
    await voice(page, VOICE_NAMES[5]).tap();
    await expectReachable(button(page, 'Continue'), 'Continue');
    await button(page, 'Continue').tap();

    // Step 3, before connecting
    await expectOnboardingStep(page, 3);
    expect(await fitsViewportWidth(page), 'step 3: no sideways scrolling').toBe(true);
    await expectStepNames(page, 3, false);
    for (const name of ['Skip setup', 'Back', 'Skip for now', 'Connect YouTube']) {
      await expectReachable(button(page, name), name);
    }

    // Step 3 with the longest failure message
    await button(page, 'Connect YouTube').tap();
    await expect(h1(page)).toHaveText('Google (mock)');
    await page.getByRole('button', {name: 'This account has no YouTube channel'}).tap();
    await expectOnboardingStep(page, 3);
    await expect(page.getByRole('alert').getByRole('link', {name: 'Create a YouTube channel'})).toBeVisible();
    expect(await fitsViewportWidth(page), 'step 3 with a failure: no sideways scrolling').toBe(true);
    for (const name of ['Skip setup', 'Back', 'Skip for now', 'Try again']) await expectReachable(button(page, name), name);

    // Step 3 connected, with a long channel name
    await button(page, 'Try again').tap();
    await expect(h1(page)).toHaveText('Google (mock)');
    await page.getByLabel('Channel name').fill(LONG_CHANNEL);
    await page.getByRole('button', {name: 'Allow', exact: true}).tap();
    await expectOnboardingStep(page, 3, 'YouTube connected');
    await expect(page.getByText(/^Connected as Asha Shorts/)).toBeVisible();
    expect(await fitsViewportWidth(page), 'step 3 connected: no sideways scrolling').toBe(true);
    for (const name of ['Skip setup', 'Back', 'Finish']) await expectReachable(button(page, name), name);
    await button(page, 'Finish').tap();

    await expect(page).toHaveURL(/\/app$/);
    expect(await currentUser(page)).toMatchObject({
      niche: `Motivation, Education, ${'W'.repeat(40)}`,
      onboardingCompleted: true,
      connections: {youtube: {status: 'connected', name: LONG_CHANNEL}},
    });
  });

  test('error messages on each step fit the width', async ({page}) => {
    await installFaultInjection(page);
    await startOnboarding(page);
    const longMessage = 'We could not save your choices just now because the service is busy. Please wait a moment and try again.';
    await setFaults(page, [{method: 'PATCH', path: '/me', status: 500, code: 'internal_error', message: longMessage}]);

    await topic(page, 'Fitness').tap();
    await button(page, 'Continue').tap();
    await expect(page.getByRole('alert').filter({hasText: longMessage})).toBeVisible();
    expect(await fitsViewportWidth(page), 'step 1 with a save error').toBe(true);

    await button(page, 'Skip setup').tap();
    await expect(page.getByRole('alert').filter({hasText: longMessage})).toHaveCount(2);
    expect(await fitsViewportWidth(page), 'step 1 with a finish error as well').toBe(true);
    await expectReachable(button(page, 'Continue'), 'Continue');
  });

  // QA-038: "Skip setup" was a 65x20 px target. WCAG 2.2 (2.5.8) asks for at least 24x24.
  test('"Skip setup" is a touch target of at least 24 by 24 px that stays on screen', async ({page}) => {
    await startOnboarding(page);

    for (const step of [1, 2, 3] as OnboardingStep[]) {
      const box = (await button(page, 'Skip setup').boundingBox())!;
      expect(box.height, `height on step ${step}`).toBeGreaterThanOrEqual(24);
      expect(box.width, `width on step ${step}`).toBeGreaterThanOrEqual(24);
      await expectReachable(button(page, 'Skip setup'), 'Skip setup');
      if (step < 3) {
        await button(page, 'Skip for now').tap();
        await expectOnboardingStep(page, (step + 1) as OnboardingStep);
      }
    }
    await button(page, 'Skip setup').tap();
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('the stepper at different widths', () => {
  for (const {width, othersVisible} of [
    {width: 399, othersVisible: false},
    {width: 400, othersVisible: true},
    {width: 1280, othersVisible: true},
  ]) {
    test(`at ${width} px the names of the other steps are ${othersVisible ? 'shown' : 'hidden'}, and the current step is always named`, async ({page}) => {
      await page.setViewportSize({width, height: 800});
      await startOnboarding(page, 1);
      await expectStepNames(page, 1, othersVisible);

      await button(page, 'Skip for now').click();
      await expectOnboardingStep(page, 2);
      await expectStepNames(page, 2, othersVisible);
      expect(await fitsViewportWidth(page)).toBe(true);
    });
  }
});

test.describe('onboarding accessibility basics', () => {
  /** One h1, every control named, no control nested in another, and the stepper marks exactly this step. */
  async function expectBasics(page: Page, stepLabel: string) {
    await expect(h1(page)).toHaveCount(1);
    expect(await controlsWithoutAName(page), 'controls without a name').toEqual([]);
    expect(await nestedInteractiveControls(page), 'nested controls').toEqual([]);
    await expect(setupSteps(page).getByRole('listitem')).toHaveCount(3);
    await expect(currentSetupStep(page)).toHaveCount(1);
    await expect(currentSetupStep(page)).toContainText(stepLabel);
    await expect(page.getByRole('main')).toHaveCount(1);
  }

  test('each step has one h1, named controls and a stepper that exposes the current step, and the whole setup works with the keyboard alone', async ({page}) => {
    await startOnboarding(page);

    // Step 1: choose a topic and type a second one.
    await expectBasics(page, 'Niche');
    await expect(page.getByRole('group', {name: 'Topics'})).toBeVisible();
    await tabTo(page, topic(page, 'Fitness'));
    await page.keyboard.press('Space');
    await expect(topic(page, 'Fitness')).toHaveAttribute('aria-pressed', 'true');
    await tabTo(page, page.getByLabel('Something else'));
    await page.keyboard.type('gardening');
    await tabTo(page, button(page, 'Continue'));
    await page.keyboard.press('Enter');

    // Step 2: choose a voice.
    await expectOnboardingStep(page, 2);
    await expect(page.getByRole('radio')).toHaveCount(6);
    await expectBasics(page, 'Voice');
    await expectSetupStepState(page, 1, 'done');
    await expect(page.getByRole('radiogroup', {name: 'Voices'})).toBeVisible();
    // The sample buttons are reachable and usable by keyboard too.
    await tabTo(page, button(page, `Play ${VOICE_NAMES[0]} sample`));
    await page.keyboard.press('Enter');
    await expect(page.getByText("Couldn't play this sample.")).toHaveCount(0);
    await tabTo(page, voice(page, VOICE_NAMES[0]));
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(voice(page, VOICE_NAMES[1])).toBeChecked();
    await tabTo(page, button(page, 'Continue'));
    await page.keyboard.press('Enter');

    // Step 3: finish without connecting.
    await expectOnboardingStep(page, 3);
    await expectBasics(page, 'YouTube');
    await tabTo(page, button(page, 'Connect YouTube'));
    await page.keyboard.press('Shift+Tab');
    await expect(button(page, 'Skip for now')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app$/);
    expect(await currentUser(page)).toMatchObject({
      niche: 'Fitness, gardening',
      defaults: {voiceId: listVoices()[1].id},
      onboardingCompleted: true,
    });
  });

  test('"Skip setup" can be reached and used with the keyboard', async ({page}) => {
    await startOnboarding(page, 2);

    await tabTo(page, button(page, 'Skip setup'));
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
  });

  test('step 3 keeps one h1 and named controls in its failed and connected states, and failures are announced', async ({page}) => {
    await startOnboarding(page, 3);
    await button(page, 'Connect YouTube').click();
    await expect(h1(page)).toHaveText('Google (mock)');
    await expect(h1(page)).toHaveCount(1);
    expect(await controlsWithoutAName(page), 'stand-in Google page').toEqual([]);
    await page.getByRole('button', {name: 'Deny the permissions'}).click();

    await expectOnboardingStep(page, 3);
    // role="alert": a screen reader announces the failure when it appears.
    await expect(page.getByRole('alert').filter({hasText: "We couldn't connect your channel"})).toBeVisible();
    await expectBasics(page, 'YouTube');

    await tabTo(page, button(page, 'Try again'));
    await page.keyboard.press('Enter');
    await expect(h1(page)).toHaveText('Google (mock)');
    await tabTo(page, page.getByRole('button', {name: 'Allow', exact: true}));
    await page.keyboard.press('Enter');

    await expectOnboardingStep(page, 3, 'YouTube connected');
    await expectBasics(page, 'YouTube');
    await tabTo(page, button(page, 'Finish'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app$/);
  });
});

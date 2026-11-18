import {expect, test} from '@playwright/test';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  emailField,
  h1,
  loginAsDemo,
  logOut,
  NEW_USER,
  passwordField,
  signUp,
  submitLogin,
} from './helpers';

// PRD 5.1 (A1, A2), flow 1, edge cases 11.1; API_DESIGN.md A1-A9.

const VERIFY_BANNER = 'Verify your email to start creating Reels.';
const LINK_EXPIRED = 'This link has expired or was already used.';
const WRONG_LOGIN = 'Wrong email or password.';

test.describe('signed out', () => {
  test('a visitor is sent to the login page', async ({page}) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(h1(page)).toHaveText('Welcome back');
  });

  test('protected pages are not reachable', async ({page}) => {
    for (const path of ['/app', '/app/projects', '/app/settings', '/admin']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
    }
  });
});

test.describe('sign up and verify email', () => {
  test('sign up, open the verification link, and land in the app verified', async ({page}) => {
    await signUp(page);
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.getByText(`We sent a verification link to ${NEW_USER.email}.`)).toBeVisible();

    await page.getByRole('link', {name: 'Open the verification link'}).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByRole('link', {name: '100 of 100 credits left'})).toBeVisible();
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);

    // Still verified after a reload.
    await page.reload();
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);
  });

  /** Signs up, verifies with the emailed link, and returns that (now used) link. */
  async function signUpAndVerify(page: import('@playwright/test').Page): Promise<string> {
    await signUp(page);
    const link = page.getByRole('link', {name: 'Open the verification link'});
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    return href;
  }

  test('a used link opened again by the same, now verified, user says the email is already verified', async ({page}) => {
    const href = await signUpAndVerify(page);

    await page.goto(href);

    await expect(h1(page)).toHaveText('Your email is already verified');
    // Nothing to resend, and nothing that reads like a failure.
    await expect(page.getByRole('button', {name: /resend/i})).toHaveCount(0);
    await expect(page.getByText("This link didn't work")).toHaveCount(0);

    await page.getByRole('link', {name: 'Go to ReelForge'}).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);
  });

  test('a used link opened by a signed-out visitor shows the expired/used message and a way to get a new one', async ({page}) => {
    const href = await signUpAndVerify(page);
    await logOut(page);

    await page.goto(href);

    await expect(h1(page)).toHaveText("This link didn't work");
    await expect(page.getByText(LINK_EXPIRED)).toBeVisible();
    await expect(page.getByRole('button', {name: /resend/i})).toHaveCount(0);

    await page.getByRole('link', {name: 'Log in to get a new link'}).click();
    await expect(page).toHaveURL(/\/login$/);
    // The link did not sign anyone in.
    await expect(h1(page)).toHaveText('Welcome back');
  });

  test('a signed-out, still unverified user with a bad link can log in and lands on the resend screen', async ({page}) => {
    await signUp(page);
    await page.goto('/app');
    await logOut(page);

    await page.goto('/verify?token=not-a-real-token');
    await expect(page.getByText(LINK_EXPIRED)).toBeVisible();
    await page.getByRole('link', {name: 'Log in to get a new link'}).click();
    await submitLogin(page, NEW_USER.email, NEW_USER.password);

    await expect(page).toHaveURL(/\/verify$/);
    await expect(h1(page)).toHaveText('Check your inbox');
    await page.getByRole('button', {name: 'Resend email'}).click();
    await expect(page.getByText('Sent. It can take a minute to arrive.')).toBeVisible();
  });

  test('a made-up verification link shows the expired/used message and leaves the account unverified', async ({page}) => {
    await signUp(page);

    await page.goto('/verify?token=not-a-real-token');

    await expect(h1(page)).toHaveText("This link didn't work");
    await expect(page.getByText(LINK_EXPIRED)).toBeVisible();

    await page.getByRole('link', {name: 'Back to ReelForge'}).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(VERIFY_BANNER)).toBeVisible();
  });

  // PRD 11.1 A-2: "Verification link expired or used twice: show a clear message and a Resend button."
  test('the expired-link screen itself has a Resend button that sends a new link (PRD A-2)', async ({page}) => {
    await signUp(page);
    const firstHref = await page.getByRole('link', {name: 'Open the verification link'}).getAttribute('href');

    await page.goto('/verify?token=not-a-real-token');

    await expect(page.getByText(LINK_EXPIRED)).toBeVisible();
    await page.getByRole('button', {name: 'Resend email'}).click();
    await expect(page.getByText('Sent. It can take a minute to arrive.')).toBeVisible();

    // The new link works when it is opened the way an email link is: as a fresh page load.
    const newLink = page.getByRole('link', {name: 'Open the verification link'});
    await expect(newLink).not.toHaveAttribute('href', firstHref!);
    await page.goto((await newLink.getAttribute('href'))!);
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);
  });

  // Mock mode: the screen shows the new link itself, in place of the email.
  test('the mock-mode link shown after a resend on the expired-link screen verifies the account when clicked', async ({page}) => {
    await signUp(page);
    await page.goto('/verify?token=not-a-real-token');
    await page.getByRole('button', {name: 'Resend email'}).click();
    await expect(page.getByText('Sent. It can take a minute to arrive.')).toBeVisible();

    await page.getByRole('link', {name: 'Open the verification link'}).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);
  });

  test('a signed-out visitor on the verify page is asked to log in', async ({page}) => {
    await page.goto('/verify');

    await expect(h1(page)).toHaveText('Check your inbox');
    await expect(page.getByRole('button', {name: 'Resend email'})).toHaveCount(0);
    await page.getByRole('link', {name: 'Log in'}).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('sign-up validation', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/signup');
    await expect(h1(page)).toHaveText('Create your studio');
  });

  const submit = (page: import('@playwright/test').Page) => page.getByRole('button', {name: 'Create account'}).click();

  test('an empty form asks for every field and creates no account', async ({page}) => {
    await submit(page);

    await expect(page.getByText('Tell us your name.')).toBeVisible();
    await expect(page.getByText('Enter your email.')).toBeVisible();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('a malformed email is rejected', async ({page}) => {
    await page.getByLabel('Name').fill(NEW_USER.name);
    await emailField(page).fill('not-an-email');
    await passwordField(page).fill(NEW_USER.password);
    await submit(page);

    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(emailField(page)).toHaveAccessibleDescription('Enter a valid email address.');
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('a password under 8 characters is rejected', async ({page}) => {
    await page.getByLabel('Name').fill(NEW_USER.name);
    await emailField(page).fill(NEW_USER.email);
    await passwordField(page).fill('short12');
    await submit(page);

    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('a common password is rejected by the server and the message appears on the password field', async ({page}) => {
    await page.getByLabel('Name').fill(NEW_USER.name);
    await emailField(page).fill(NEW_USER.email);
    await passwordField(page).fill('password');
    await submit(page);

    await expect(passwordField(page)).toHaveAccessibleDescription('That password is too common.');
    await expect(page).toHaveURL(/\/signup$/);
  });

  // PRD 11.1 A-1: show "account exists", offer login or password reset.
  test('an email that is already registered shows the account-exists message and offers login and password reset', async ({page}) => {
    await page.getByLabel('Name').fill(NEW_USER.name);
    await emailField(page).fill(`  ${DEMO_EMAIL.toUpperCase()} `);
    await passwordField(page).fill(NEW_USER.password);
    await submit(page);

    const notice = page.getByRole('alert').filter({hasText: 'An account with this email already exists.'});
    await expect(notice).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(notice.getByRole('link', {name: 'Log in'})).toBeVisible();

    await notice.getByRole('link', {name: 'reset your password'}).click();
    await expect(page).toHaveURL(/\/forgot$/);
    await expect(h1(page)).toHaveText('Reset your password');

    await page.goBack();
    await page.getByRole('link', {name: 'Log in'}).first().click();
    await expect(page).toHaveURL(/\/login$/);
    // Nobody was signed in by the failed attempt.
    await expect(h1(page)).toHaveText('Welcome back');
  });

  test('the account-exists message goes away when the form is sent again with a free email', async ({page}) => {
    await page.getByLabel('Name').fill(NEW_USER.name);
    await emailField(page).fill(DEMO_EMAIL);
    await passwordField(page).fill(NEW_USER.password);
    await submit(page);
    await expect(page.getByText('An account with this email already exists.')).toBeVisible();

    await emailField(page).fill(NEW_USER.email);
    await submit(page);

    await expect(h1(page)).toHaveText('Check your inbox');
    await expect(page.getByText(`We sent a verification link to ${NEW_USER.email}.`)).toBeVisible();
  });
});

test.describe('unverified account', () => {
  test('can open the app, sees the verify banner, and can resend the email from it', async ({page}) => {
    await signUp(page);

    await page.goto('/app');

    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toBeVisible();

    await page.getByRole('button', {name: 'Resend email'}).click();
    await expect(page.getByText('Sent', {exact: true})).toBeVisible();

    // The banner is on every app page.
    await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Projects'}).click();
    await expect(h1(page)).toHaveText('Your Reels');
    await expect(page.getByText(VERIFY_BANNER)).toBeVisible();
  });

  test('resending from the check-your-inbox screen issues a new link that verifies the account', async ({page}) => {
    await signUp(page);
    const link = page.getByRole('link', {name: 'Open the verification link'});
    const firstHref = (await link.getAttribute('href'))!;

    await page.getByRole('button', {name: 'Resend email'}).click();

    await expect(page.getByText('Sent. It can take a minute to arrive.')).toBeVisible();
    await expect(link).not.toHaveAttribute('href', firstHref);
    await link.click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toHaveCount(0);
  });

  test('can log out and log back in, and is still asked to verify', async ({page}) => {
    await signUp(page);
    await page.goto('/app');
    await logOut(page);

    await submitLogin(page, NEW_USER.email, NEW_USER.password);

    // Signed in again. (Whether login lands on the app or on the check-your-inbox screen is not specified.)
    await expect(page).toHaveURL(/\/(app|verify)$/);
    await page.goto('/app');
    await expect(h1(page)).toHaveText('Welcome, Asha');
    await expect(page.getByText(VERIFY_BANNER)).toBeVisible();
  });

  test('"Start again" on the check-your-inbox screen signs out and returns to sign up', async ({page}) => {
    await signUp(page);

    await page.getByRole('button', {name: 'Start again'}).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(h1(page)).toHaveText('Create your studio');
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('log in', () => {
  test('a wrong password shows the error and stays on the login page', async ({page}) => {
    await page.goto('/login');
    await submitLogin(page, DEMO_EMAIL, 'not-the-password');

    await expect(page.getByRole('alert').filter({hasText: WRONG_LOGIN})).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // The same form still works with the right password.
    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('an unknown email shows the same message as a wrong password', async ({page}) => {
    await page.goto('/login');
    await submitLogin(page, 'nobody@example.com', DEMO_PASSWORD);

    await expect(page.getByRole('alert').filter({hasText: WRONG_LOGIN})).toBeVisible();
  });

  test('an empty form asks for the email and the password', async ({page}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Log in'}).click();

    await expect(page.getByText('Enter your email.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
  });

  test('the demo login link fills the form and logs in to the dashboard', async ({page}) => {
    await page.goto('/login');
    await page.getByRole('button', {name: 'Fill in the demo login'}).click();
    await expect(emailField(page)).toHaveValue(DEMO_EMAIL);
    await page.getByRole('button', {name: 'Log in'}).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('the email is accepted in any case and with spaces around it', async ({page}) => {
    await page.goto('/login');
    await submitLogin(page, `  ${DEMO_EMAIL.toUpperCase()} `, DEMO_PASSWORD);

    await expect(page).toHaveURL(/\/app$/);
  });

  test('after logging in, the visitor is returned to the page they asked for, query string included', async ({page}) => {
    await page.goto('/app/settings?tab=credits');
    await expect(page).toHaveURL(/\/login$/);

    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);

    await expect(page).toHaveURL(/\/app\/settings\?tab=credits$/);
    await expect(h1(page)).toHaveText('Settings');
  });

  test('a signed-in user is redirected away from the login and sign-up pages', async ({page}) => {
    await loginAsDemo(page);

    for (const path of ['/login', '/signup', '/forgot']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/app$/);
      await expect(h1(page)).toHaveText(/^Hey /);
    }
  });

  test('the session survives a reload', async ({page}) => {
    await loginAsDemo(page);
    await page.reload();

    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('the show/hide button reveals and hides the password', async ({page}) => {
    await page.goto('/login');
    await passwordField(page).fill('secret-value');
    await expect(passwordField(page)).toHaveAttribute('type', 'password');

    await page.getByRole('button', {name: 'Show password'}).click();
    await expect(passwordField(page)).toHaveAttribute('type', 'text');
    await expect(passwordField(page)).toHaveValue('secret-value');

    await page.getByRole('button', {name: 'Hide password'}).click();
    await expect(passwordField(page)).toHaveAttribute('type', 'password');
  });
});

test.describe('forgot and reset password', () => {
  const NEW_PASSWORD = 'A-new-demo-pass-2';
  const newPassword = (page: import('@playwright/test').Page) => page.getByLabel('New password', {exact: true});
  const confirmPassword = (page: import('@playwright/test').Page) => page.getByLabel('Confirm password', {exact: true});

  /** Requests a reset for the demo account and returns the link the email would contain. */
  async function requestReset(page: import('@playwright/test').Page): Promise<string> {
    await page.goto('/login');
    await page.getByRole('link', {name: 'Forgot password?'}).click();
    await expect(h1(page)).toHaveText('Reset your password');
    await emailField(page).fill(DEMO_EMAIL);
    await page.getByRole('button', {name: 'Send reset link'}).click();
    await expect(h1(page)).toHaveText('Check your inbox');
    await expect(page.getByText(`If an account exists for ${DEMO_EMAIL}, we sent a link to reset your password.`)).toBeVisible();
    return (await page.getByRole('link', {name: 'Open the reset link'}).getAttribute('href'))!;
  }

  test('reset the password: mismatch is caught, then the new password works and the old one does not', async ({page}) => {
    await requestReset(page);
    await page.getByRole('link', {name: 'Open the reset link'}).click();
    await expect(h1(page)).toHaveText('Choose a new password');

    await newPassword(page).fill(NEW_PASSWORD);
    await confirmPassword(page).fill(`${NEW_PASSWORD}-typo`);
    await page.getByRole('button', {name: 'Update password'}).click();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page).toHaveURL(/\/reset\?token=/);

    await confirmPassword(page).fill(NEW_PASSWORD);
    await page.getByRole('button', {name: 'Update password'}).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Password updated. Log in with your new password.')).toBeVisible();

    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page.getByRole('alert').filter({hasText: WRONG_LOGIN})).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await submitLogin(page, DEMO_EMAIL, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('a reset link that was already used fails and offers a new one', async ({page}) => {
    const href = await requestReset(page);
    await page.goto(href);
    await newPassword(page).fill(NEW_PASSWORD);
    await confirmPassword(page).fill(NEW_PASSWORD);
    await page.getByRole('button', {name: 'Update password'}).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(href);
    await newPassword(page).fill('Another-pass-3');
    await confirmPassword(page).fill('Another-pass-3');
    await page.getByRole('button', {name: 'Update password'}).click();

    const alert = page.getByRole('alert').filter({hasText: LINK_EXPIRED});
    await expect(alert).toBeVisible();
    await alert.getByRole('link', {name: 'Get a new link'}).click();
    await expect(h1(page)).toHaveText('Reset your password');

    // The second attempt changed nothing: the password from the first reset is the one that works.
    await page.goto('/login');
    await submitLogin(page, DEMO_EMAIL, 'Another-pass-3');
    await expect(page.getByRole('alert').filter({hasText: WRONG_LOGIN})).toBeVisible();
    await submitLogin(page, DEMO_EMAIL, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('a new password under 8 characters is rejected', async ({page}) => {
    const href = await requestReset(page);
    await page.goto(href);
    await newPassword(page).fill('short12');
    await confirmPassword(page).fill('short12');
    await page.getByRole('button', {name: 'Update password'}).click();

    await expect(newPassword(page)).toHaveAccessibleDescription('Use at least 8 characters.');
    await expect(page).toHaveURL(/\/reset\?token=/);
  });

  // PRD 11.1 A-1: the reset page must not reveal whether an account exists.
  test('an unknown email gets the same confirmation as a real one', async ({page}) => {
    await page.goto('/forgot');
    await emailField(page).fill('nobody@example.com');
    await page.getByRole('button', {name: 'Send reset link'}).click();

    await expect(h1(page)).toHaveText('Check your inbox');
    await expect(
      page.getByText('If an account exists for nobody@example.com, we sent a link to reset your password.'),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the forgot-password form needs a valid email', async ({page}) => {
    await page.goto('/forgot');
    await page.getByRole('button', {name: 'Send reset link'}).click();
    await expect(page.getByText('Enter your email.')).toBeVisible();

    await emailField(page).fill('not-an-email');
    await page.getByRole('button', {name: 'Send reset link'}).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(h1(page)).toHaveText('Reset your password');
  });

  // Change after QA question 9: a reset link from an email must work whether or not this browser is signed in.
  test('a signed-in user can use a reset link, and is signed out by the reset', async ({page}) => {
    const href = await requestReset(page);
    await page.goto('/login');
    await submitLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);

    await page.goto(href);
    await expect(h1(page)).toHaveText('Choose a new password');
    await newPassword(page).fill(NEW_PASSWORD);
    await confirmPassword(page).fill(NEW_PASSWORD);
    await page.getByRole('button', {name: 'Update password'}).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Password updated. Log in with your new password.')).toBeVisible();
    // All sessions are revoked (API A8), this one included.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
    await submitLogin(page, DEMO_EMAIL, NEW_PASSWORD);
    await expect(h1(page)).toHaveText(/^Hey /);
  });

  test('a reset link without a token explains itself and offers a new link', async ({page}) => {
    await page.goto('/reset');

    await expect(h1(page)).toHaveText("This link didn't work");
    await page.getByRole('link', {name: 'Get a new link'}).click();
    await expect(page).toHaveURL(/\/forgot$/);
  });
});

test.describe('log out', () => {
  // On the demo dashboard the account menu opens over the Reel cards (1280x720 window).
  test('Log out can be clicked from the dashboard while Reels are on screen', async ({page}) => {
    await loginAsDemo(page);
    await expect(page.getByRole('region', {name: 'Recent Reels'}).getByRole('article')).toHaveCount(5);

    await logOut(page);
    await expect(h1(page)).toHaveText('Welcome back');
  });

  test('returns to the login page and protected pages are no longer reachable', async ({page}) => {
    await loginAsDemo(page);
    // Log out from a screen where nothing sits under the account menu.
    await page.getByRole('navigation', {name: 'Main'}).getByRole('link', {name: 'Settings'}).click();
    await expect(h1(page)).toHaveText('Settings');

    await logOut(page);
    await expect(h1(page)).toHaveText('Welcome back');

    for (const path of ['/app', '/app/projects']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
    }
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the account menu shows who is signed in and closes on Escape', async ({page}) => {
    await loginAsDemo(page);

    await page.getByRole('button', {name: 'Account menu'}).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText(DEMO_EMAIL);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(/\/app$/);
  });
});

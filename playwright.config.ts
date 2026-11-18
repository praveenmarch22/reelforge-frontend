import {defineConfig, devices} from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // The dev server compiles modules on demand, so page loads are slow when several workers share it.
  // Several flows need four or five full page loads; give them room so load never decides a result.
  timeout: 90_000,
  expect: {timeout: 10_000},
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', {open: 'never'}]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  // Starts the app with the mock API; reuses a dev server that is already running locally.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});

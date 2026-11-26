import {defineConfig, devices} from '@playwright/test';

/*
 * Browser tests against the REAL backend (with mock AI providers), for the screens that do not use
 * the MSW mock (New Reel and Script editor, F5). `npm run test:e2e` (mock-based) is separate.
 *
 * How to run:
 *   1. Start a throwaway backend stack from a copy of the backend repository (never the main one):
 *        git -C ../backend archive HEAD | tar -x -C <scratch>/f5stack
 *        cd <scratch>/f5stack
 *        API_PORT=5200 POSTGRES_PORT=54340 REDIS_PORT=63810 MINIO_PORT=9200 MINIO_CONSOLE_PORT=9201 \
 *        MAILPIT_PORT=8225 LLM_PROVIDERS=mock VOICE_PROVIDERS=mock STOCK_PROVIDERS=mock IMAGE_PROVIDERS=mock \
 *        RATE_LIMITS_ENABLED=false WEB_ORIGIN=http://localhost:5174 \
 *        docker compose -p rff5 up -d --build --wait
 *   2. npx playwright test -c playwright.real.config.ts
 *      (starts `vite --mode real` on port 5174 itself, or reuses one already running there)
 *   3. docker compose -p rff5 down -v
 *
 * Settings (environment variables, defaults match step 1): REAL_API_PORT (5200), REAL_WEB_PORT
 * (5174), REAL_MAILPIT_URL (http://127.0.0.1:8225), REAL_COMPOSE_PROJECT (rff5; used to set a
 * test account's credit balance with psql).
 */

const webPort = Number(process.env.REAL_WEB_PORT ?? 5174);
const apiPort = Number(process.env.REAL_API_PORT ?? 5200);

export default defineConfig({
  testDir: './e2e-real',
  timeout: 90_000,
  expect: {timeout: 15_000},
  fullyParallel: true,
  // One Celery worker runs every job; a few browsers at a time keep job times predictable.
  workers: 3,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e-real/global-setup.ts',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: `npx vite --mode real --port ${webPort} --strictPort`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`},
  },
});

import {fileURLToPath, URL} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  server: {
    port: 5173,
    strictPort: true,
    // `npm run dev:real`: API calls go through Vite to the local backend (Docker), so they come
    // from the web app's own address and the sign-in cookies work as they will in production.
    proxy: {'/api': {target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5000', changeOrigin: false}},
  },
  test: {
    // Unit and component tests. Browser end-to-end tests live in e2e/ and run with Playwright.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // The editor's component tests render a lot; a loaded machine (or CI) needs more than 5 s.
    testTimeout: 15_000,
  },
});

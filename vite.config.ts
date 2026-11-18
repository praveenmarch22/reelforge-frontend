import {fileURLToPath, URL} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  server: {port: 5173, strictPort: true},
  test: {
    // Unit and component tests. Browser end-to-end tests live in e2e/ and run with Playwright.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});

import { defineConfig, devices } from '@playwright/test';

// Browser tests against a production build and a local game server
// (wrangler dev), so online play is covered too. Run with `npm run e2e`.
// Set CHROMIUM_PATH to use an already-installed Chromium instead of
// Playwright's own download.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'npx wrangler dev --port 8787 --ip 127.0.0.1',
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      env: { VITE_SERVER_URL: 'ws://127.0.0.1:8787' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

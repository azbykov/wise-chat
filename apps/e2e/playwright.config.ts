import { defineConfig, devices } from '@playwright/test';

// The tests drive a running stack (`docker compose up --build --wait`), the same one a user gets.
// Sign-up and sign-in are rate limited per IP: start the stack with AUTH_RATE_LIMIT_PER_MINUTE=1000.
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'microphone'],
        launchOptions: {
          // A synthetic camera and microphone: stories can be recorded without hardware.
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
});

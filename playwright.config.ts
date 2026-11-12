import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 45000, use: { browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', headless: true, acceptDownloads: true },
  reporter: 'list', outputDir: 'test-results',
});

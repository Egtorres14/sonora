import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, expect: { timeout: 20000 }, workers: 1,
  reporter: 'list', outputDir: 'output/playwright/test-results',
  use: { baseURL: 'http://127.0.0.1:3017', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3017 --strictPort', url: 'http://127.0.0.1:3017', reuseExistingServer: false, timeout: 30000 },
});

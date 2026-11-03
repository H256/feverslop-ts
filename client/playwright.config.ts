import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  use: {browserName: 'chromium', headless: true, trace: 'retain-on-failure'},
})

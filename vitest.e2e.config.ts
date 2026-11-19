import { defineConfig } from 'vitest/config'

// Real-browser tests: builds the examples, serves them, drives Chromium with Playwright.
// Needs a Chromium for Playwright (`npx playwright install chromium`); PLAYWRIGHT_BROWSERS_PATH is honoured.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    globalSetup: ['tests/e2e/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    reporters: ['default']
  }
})

import { defineConfig, devices } from '@playwright/test'

/**
 * Browser e2e of the AI assistant against the FULL local stack (`../stack/up.sh`: this
 * platform, a real agent-core with its demo doubles, llm-gateway → OpenRouter). Not part of
 * `pnpm e2e`: run it with `pnpm e2e:stack` once the stack is up (RUNBOOK §9.1).
 *
 * Nothing is started here: the platform API and the SPA are the stack's own (8100 and 5174 by
 * default; `STACK_API_URL` and `STACK_WEB_URL` override them). The shared page objects and API
 * helpers of `../e2e/support` read their origins from `E2E_API_URL` / `E2E_WEB_URL`, set below.
 *
 * The model is nondeterministic: the scenarios assert states and structure, never the model's
 * words, wait generously for its answers and retry a conversation a bounded number of times
 * when the outcome they need did not happen.
 */

const apiURL = process.env.STACK_API_URL ?? 'http://127.0.0.1:8100'
const webURL = process.env.STACK_WEB_URL ?? 'http://localhost:5174'
process.env.E2E_API_URL = apiURL
process.env.E2E_WEB_URL = webURL

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // One stack, two linked customers and one routing rule (least loaded among the available):
  // the scenarios run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A scenario waits for several model answers (a few seconds each, up to the platform's
  // agent-core timeout) and may retry its conversation.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report/stack' }]],
  outputDir: '../test-results/stack',
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: webURL,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})

import { test as base, expect } from '../../e2e/support/fixtures'
import type { DemoCustomerRef } from '../../e2e/support/data'
import { WorkspacePage } from '../../e2e/support/pages/workspace-page'
import { ACCOUNTS, LINKED } from './accounts'
import { AssistantChat } from './assistant-chat'
import { StackApi } from './stack-api'

interface StackFixtures {
  /**
   * Every scenario starts and ends in the same state: AI on, nobody available, the linked
   * customers without an open conversation. Automatic.
   */
  cleanStack: void
  /** A window on the simulator, chatting as a linked customer. */
  chatAs(label: string, customer: DemoCustomerRef): Promise<AssistantChat>
  /** Tomás Arango signed in on "Casos" and available: the person a hand-over reaches. */
  availableAnalyst(): Promise<WorkspacePage>
}

interface StackWorkerFixtures {
  stack: StackApi
}

async function reset(stack: StackApi): Promise<void> {
  await stack.setAiEnabled(true)
  await stack.setAvailability(ACCOUNTS.analyst, 'paused')
  for (const customer of Object.values(LINKED)) await stack.releaseCustomer(customer.id)
}

// Playwright's fixture callback is named `provide` here: oxlint's rules-of-hooks takes `use` for
// React's hook.
export const test = base.extend<StackFixtures, StackWorkerFixtures>({
  stack: [
    async ({ playwright }, provide) => {
      const request = await playwright.request.newContext()
      await provide(new StackApi(request))
      await request.dispose()
    },
    { scope: 'worker' },
  ],

  cleanStack: [
    async ({ stack }, provide) => {
      await reset(stack)
      await provide()
      await reset(stack)
    },
    { auto: true },
  ],

  chatAs: async ({ actors }, provide) => {
    async function chatAs(label: string, customer: DemoCustomerRef): Promise<AssistantChat> {
      const chat = new AssistantChat(await actors.open(label), customer)
      await chat.open()
      return chat
    }
    await provide(chatAs)
  },

  availableAnalyst: async ({ actors }, provide) => {
    async function availableAnalyst(): Promise<WorkspacePage> {
      const { page } = await actors.signedIn('analista', ACCOUNTS.analyst)
      const workspace = new WorkspacePage(page)
      await workspace.goto()
      await workspace.becomeAvailable()
      return workspace
    }
    await provide(availableAnalyst)
  },
})

export { expect }

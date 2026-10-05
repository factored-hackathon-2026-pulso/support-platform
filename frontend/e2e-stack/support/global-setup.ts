import { request } from '@playwright/test'
import { WEB_URL } from '../../e2e/support/env'
import { LINKED } from './accounts'
import { StackApi } from './stack-api'

/**
 * Checks that the stack is up and wired to agent-core, and puts it in the state every scenario
 * starts from: AI on, nobody available, the two linked customers without an open conversation.
 */
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext()
  try {
    const api = new StackApi(context)
    try {
      await api.meta()
    } catch (error) {
      throw new Error(
        `the stack's platform API does not answer (start it with stack/up.sh): ${String(error)}`,
      )
    }
    const web = await context.get(WEB_URL).catch(() => null)
    if (!web?.ok()) throw new Error(`the stack's web app does not answer at ${WEB_URL}`)
    const platform = await api.platform()
    if (!platform.agentCoreConfigured) {
      throw new Error('the platform is not connected to agent-core (CC_AGENT_CORE_URL)')
    }
    await api.setAiEnabled(true)
    await api.pauseEveryone()
    for (const customer of Object.values(LINKED)) await api.releaseCustomer(customer.id)
  } finally {
    await context.dispose()
  }
}

import { randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import type { components } from '../../src/lib/api/schema.gen'
import { DEMO_PASSWORD, DEV_MFA_CODE } from '../../e2e/support/data'
import { totpCode } from '../../e2e/support/totp'
import { API_URL } from '../../e2e/support/env'
import { ACCOUNTS, SEEDED_ANALYSTS, type SeededAccount } from './accounts'

type Schemas = components['schemas']
export type CustomerConversationResponse = Schemas['CustomerConversationResponse']
export type CustomerConversation = Schemas['CustomerConversation']
export type CustomerTurn = Schemas['CustomerTurn']
export type CaseSummary = Schemas['CaseSummary']

const API = `${API_URL}/api/v1`

async function json<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`)
  }
  return (await response.json()) as T
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The platform API of the stack, as setup, cleanup and the scenarios' branching use it: which
 * state the assistant left the conversation in (the source of truth the screens follow), who is
 * available, closing what a scenario opened. What a scenario checks, it checks on the screens.
 *
 * Only seeded accounts are used (password `demo1234`, dev code `000000`): the stack's database is
 * reused between runs, so the suite never leaves people behind that it could not sign in as.
 */
export class StackApi {
  private readonly tokens = new Map<string, string>()
  private readonly customerTokens = new Map<string, string>()
  private readonly request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.request = request
  }

  private auth(token: string) {
    return { Authorization: `Bearer ${token}` }
  }

  async signIn(account: SeededAccount): Promise<string> {
    const cached = this.tokens.get(account.email)
    if (cached) return cached
    const login = await json<Schemas['LoginResponse']>(
      await this.request.post(`${API}/auth/login`, {
        data: { email: account.email, password: DEMO_PASSWORD },
      }),
      `login ${account.email}`,
    )
    const code = account.totpSecret ? totpCode(account.totpSecret) : DEV_MFA_CODE
    const session = await json<Schemas['SessionResponse']>(
      await this.request.post(`${API}/auth/mfa`, {
        data: { challengeId: login.challengeId, code },
      }),
      `mfa ${account.email}`,
    )
    this.tokens.set(account.email, session.token)
    return session.token
  }

  // ── Platform ───────────────────────────────────────────────────────────────

  async meta(): Promise<Schemas['MetaResponse']> {
    return json(await this.request.get(`${API}/meta`), 'meta')
  }

  async platform(): Promise<Schemas['AdminPlatformSettings']> {
    return json(
      await this.request.get(`${API}/admin/platform`, {
        headers: this.auth(await this.signIn(ACCOUNTS.admin)),
      }),
      'admin platform',
    )
  }

  async setAiEnabled(enabled: boolean): Promise<void> {
    await json(
      await this.request.put(`${API}/admin/platform/ai`, {
        headers: this.auth(await this.signIn(ACCOUNTS.admin)),
        data: { enabled },
      }),
      `ai ${enabled ? 'on' : 'off'}`,
    )
  }

  // ── People ─────────────────────────────────────────────────────────────────

  async setAvailability(account: SeededAccount, status: 'available' | 'paused'): Promise<void> {
    await json(
      await this.request.put(`${API}/me/availability`, {
        headers: this.auth(await this.signIn(account)),
        data: { status },
      }),
      `availability ${account.email}`,
    )
  }

  /**
   * Leaves nobody available, so a hand-over reaches only the person a scenario makes
   * available (rule 3 picks the least loaded among the available). Fails, naming them, when
   * someone the suite cannot sign in as is available.
   */
  async pauseEveryone(): Promise<void> {
    const list = await json<Schemas['AdminUserList']>(
      await this.request.get(`${API}/admin/users`, {
        headers: this.auth(await this.signIn(ACCOUNTS.admin)),
        params: { status: 'active' },
      }),
      'list users',
    )
    const strangers: string[] = []
    for (const user of list.items) {
      if (user.availability !== 'available') continue
      const seeded = SEEDED_ANALYSTS.find((account) => account.email === user.email)
      if (seeded) await this.setAvailability(seeded, 'paused')
      else strangers.push(user.email)
    }
    if (strangers.length > 0) {
      throw new Error(
        `available people the suite cannot pause: ${strangers.join(', ')}. ` +
          'Pause them, or reset the stack (stack/down.sh --wipe && stack/up.sh).',
      )
    }
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  private async customerToken(customerId: string): Promise<string> {
    const cached = this.customerTokens.get(customerId)
    if (cached) return cached
    const session = await json<Schemas['CustomerSessionResponse']>(
      await this.request.post(`${API}/customer/sessions`, {
        data: { customerId, channel: 'chat_web' },
      }),
      `customer session ${customerId}`,
    )
    this.customerTokens.set(customerId, session.token)
    return session.token
  }

  /** The customer's current conversation and its turns, as the simulator reads them. */
  async conversation(customerId: string): Promise<CustomerConversationResponse> {
    return json(
      await this.request.get(`${API}/customer/conversation`, {
        headers: this.auth(await this.customerToken(customerId)),
      }),
      `conversation of ${customerId}`,
    )
  }

  /** The open conversation of a simulator customer (any channel), or null. */
  async openCase(customerId: string): Promise<{ caseId: string; status: string } | null> {
    const list = await json<Schemas['DemoCustomerList']>(
      await this.request.get(`${API}/customer/demo-customers`),
      'demo customers',
    )
    const customer = list.items.find((item) => item.id === customerId)
    if (!customer) throw new Error(`customer ${customerId} not found`)
    return customer.openConversation ?? null
  }

  async caseDetail(caseId: string): Promise<Schemas['CaseDetail']> {
    return json(
      await this.request.get(`${API}/cases/${caseId}`, {
        headers: this.auth(await this.signIn(ACCOUNTS.supervisor)),
      }),
      `case ${caseId}`,
    )
  }

  /**
   * Why the assistant let the case go when it failed, from the staff-only banner ("El asistente
   * no pudo seguir atendiendo (rate_limited)…"): agent-core's code, or null.
   */
  async failureCode(caseId: string): Promise<string | null> {
    const page = await json<Schemas['TurnPage']>(
      await this.request.get(`${API}/cases/${caseId}/turns`, {
        headers: this.auth(await this.signIn(ACCOUNTS.supervisor)),
        params: { limit: 100 },
      }),
      `turns of ${caseId}`,
    )
    for (const turn of page.items) {
      const match = /^El asistente no pudo seguir atendiendo \(([^)]+)\)/.exec(turn.text)
      if (turn.kind === 'routing' && match) return match[1] ?? null
    }
    return null
  }

  /** Whether the assignee can read a handoff packet for the case (`GET /cases/{id}/handoff`). */
  async hasHandoff(caseId: string, assignee: SeededAccount): Promise<boolean> {
    const response = await this.request.get(`${API}/cases/${caseId}/handoff`, {
      headers: this.auth(await this.signIn(assignee)),
    })
    return response.ok()
  }

  /**
   * Waits until the assistant has done what it does with the customer's last input and returns
   * the conversation: it answered `afterText` (a turn after that message) or something newer
   * than `afterSequence` arrived, and it is not writing; or it asks to confirm or for a second
   * factor; or it no longer holds the conversation.
   */
  async settled(
    customerId: string,
    {
      afterText,
      afterSequence = 0,
      timeoutMs = 150_000,
    }: { afterText?: string; afterSequence?: number; timeoutMs?: number } = {},
  ): Promise<CustomerConversationResponse> {
    const deadline = Date.now() + timeoutMs
    let last: CustomerConversationResponse | null = null
    while (Date.now() < deadline) {
      last = await this.conversation(customerId)
      const conversation = last.conversation
      if (conversation) {
        const assistant = conversation.assistant
        if (conversation.status !== 'with_assistant') return last
        if (assistant && !assistant.working) {
          if (assistant.confirmation || assistant.stepUp) return last
          if (afterText !== undefined) {
            const turns = last.turns
            const mine = turns.findLastIndex(
              (turn) => turn.authorRole === 'customer' && turn.text === afterText,
            )
            if (mine >= 0 && turns.slice(mine + 1).some((t) => t.authorRole === 'assistant')) {
              return last
            }
          } else if (conversation.lastSequence > afterSequence) {
            return last
          }
        }
      }
      await wait(1_000)
    }
    throw new Error(
      `the assistant did not settle in ${timeoutMs / 1000} s: ${JSON.stringify(last?.conversation)}`,
    )
  }

  /**
   * Leaves the customer without an open conversation: an assistant's conversation is first
   * taken from it (Supervisión's release), then the case is handed to the janitor (a paused
   * analyst who speaks Spanish and Portuguese) and closed by her. Safe to repeat.
   */
  async releaseCustomer(customerId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const open = await this.openCase(customerId)
      if (!open) return
      try {
        await this.closeCase(open.caseId)
      } catch (error) {
        if (attempt === 2) throw error
        await wait(1_500)
      }
    }
  }

  private async closeCase(caseId: string): Promise<void> {
    const supervisor = this.auth(await this.signIn(ACCOUNTS.supervisor))
    let detail = await this.caseDetail(caseId)
    if (detail.case.status === 'closed') return
    if (detail.case.status === 'with_assistant') {
      const released = await this.request.post(
        `${API}/supervision/cases/${caseId}/assistant/release`,
        { headers: supervisor },
      )
      // 409 assistant_not_active: it left the assistant meanwhile.
      if (!released.ok() && released.status() !== 409) {
        throw new Error(`release ${caseId}: HTTP ${released.status()} ${await released.text()}`)
      }
      detail = await this.caseDetail(caseId)
    }
    const janitor = await this.janitorId()
    const assignee = detail.case.assignedAnalystId ?? null
    if (assignee !== janitor) {
      await json(
        await this.request.put(`${API}/supervision/cases/${caseId}/assignee`, {
          headers: supervisor,
          data: { analystId: janitor, expectedAnalystId: assignee, confirmPaused: true },
        }),
        `move ${caseId} to the janitor`,
      )
    }
    await json(
      await this.request.post(`${API}/cases/${caseId}/close`, {
        headers: {
          ...this.auth(await this.signIn(ACCOUNTS.janitor)),
          'Idempotency-Key': randomUUID(),
        },
        data: { reason: 'other', note: 'e2e del stack: limpieza' },
      }),
      `close ${caseId}`,
    )
  }

  private janitor: string | null = null

  private async janitorId(): Promise<string> {
    if (this.janitor) return this.janitor
    const me = await json<Schemas['MeResponse']>(
      await this.request.get(`${API}/auth/me`, {
        headers: this.auth(await this.signIn(ACCOUNTS.janitor)),
      }),
      'janitor me',
    )
    this.janitor = me.staff.id
    return this.janitor
  }
}

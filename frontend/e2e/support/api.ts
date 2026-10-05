import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import type { components } from '../../src/lib/api/schema.gen'
import { API_URL } from './env'
import { DEMO_PASSWORD, DEV_MFA_CODE, SEEDED, TEAM_ANDES, type Language } from './data'
import { totpCode } from './totp'

type Schemas = components['schemas']
export type StaffRole = Schemas['StaffRole']
export type AdminUser = Schemas['AdminUser']
export type DemoCustomer = Schemas['DemoCustomer']
export type CaseDetail = Schemas['CaseDetail']

/**
 * A person created by a scenario: her id, credentials and the name the UI shows. Part 4:
 * she was invited and activated the invitation, so she signs in with her own password
 * and the code of her authenticator (`totpSecret`, the key the activation showed).
 */
export interface CreatedPerson {
  id: string
  name: string
  email: string
  password: string
  totpSecret: string
  roles: StaffRole[]
  languages: Language[]
}

/**
 * A password the policy accepts for anyone: 16 characters, digits and symbols only
 * (so it never contains her name or email), never a common one.
 */
export function strongPassword(): string {
  const group = () => String(1000 + Math.floor(Math.random() * 9000))
  return `#${group()}-${group()}-${group()}!`
}

const API = `${API_URL}/api/v1`

async function json<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`)
  }
  return (await response.json()) as T
}

/**
 * The REST API as setup and cleanup steps use it (never as the thing under
 * test): staff sign-in, creating people, simulator customers, moving a case out
 * of the way. Scenarios assert through the UI.
 */
export class PlatformApi {
  private readonly tokens = new Map<string, string>()

  private readonly request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.request = request
  }

  private auth(token: string) {
    return { Authorization: `Bearer ${token}` }
  }

  /**
   * Password + second factor → a staff session token (cached per email): her
   * authenticator code when she has a `totpSecret`, the dev code for seeded accounts.
   */
  async signIn(
    email: string,
    password: string = DEMO_PASSWORD,
    totpSecret?: string,
  ): Promise<string> {
    const cached = this.tokens.get(email)
    if (cached) return cached
    const login = await json<Schemas['LoginResponse']>(
      await this.request.post(`${API}/auth/login`, { data: { email, password } }),
      `login ${email}`,
    )
    const session = await json<Schemas['SessionResponse']>(
      await this.request.post(`${API}/auth/mfa`, {
        data: {
          challengeId: login.challengeId,
          code: totpSecret ? totpCode(totpSecret) : DEV_MFA_CODE,
        },
      }),
      `mfa ${email}`,
    )
    this.tokens.set(email, session.token)
    return session.token
  }

  forget(email: string): void {
    this.tokens.delete(email)
  }

  private adminToken(): Promise<string> {
    return this.signIn(SEEDED.admin.email)
  }

  private supervisorToken(): Promise<string> {
    return this.signIn(SEEDED.supervisor.email)
  }

  /**
   * Slice 18: Administración turns the AI functions on or off (the dev default is on). The
   * scenario that changes it puts it back on, so the others see the default app.
   */
  async setAiEnabled(enabled: boolean): Promise<void> {
    await json<Schemas['SetAiEnabledResult']>(
      await this.request.put(`${API}/admin/platform/ai`, {
        headers: this.auth(await this.adminToken()),
        data: { enabled },
      }),
      `ai ${enabled ? 'on' : 'off'}`,
    )
  }

  /** Slice 21: every case type's AI stage, as Supervisión reads it. */
  async aiStages(): Promise<Schemas['AiStages']> {
    return json<Schemas['AiStages']>(
      await this.request.get(`${API}/ai/stages`, {
        headers: this.auth(await this.supervisorToken()),
      }),
      'ai stages',
    )
  }

  /** Slice 21: Supervisión moves a case type back to an earlier stage. */
  async moveStageBack(caseType: Schemas['CaseType'], toStage: number): Promise<void> {
    await json<Schemas['MoveStageBackResult']>(
      await this.request.post(`${API}/supervision/ai/stages/${caseType}/move-back`, {
        headers: this.auth(await this.supervisorToken()),
        data: { toStage },
      }),
      `move ${caseType} back to ${toStage}`,
    )
  }

  async teamId(name: string = TEAM_ANDES): Promise<string> {
    const teams = await json<Schemas['AdminTeamList']>(
      await this.request.get(`${API}/admin/teams`, { headers: this.auth(await this.adminToken()) }),
      'list teams',
    )
    const team = teams.items.find((item) => item.name === name)
    if (!team) throw new Error(`team ${name} not found`)
    return team.id
  }

  /**
   * Part 4: administration invites a person, and she activates the invitation through
   * the public API like the activation screen does: the link from the dev mailbox, her
   * own password, then the first code of the authenticator key it returned. She starts
   * "En pausa".
   */
  async createPerson(input: {
    name: string
    email: string
    roles: StaffRole[]
    languages: Language[]
  }): Promise<CreatedPerson> {
    const invited = await json<Schemas['InvitedUser']>(
      await this.request.post(`${API}/admin/users`, {
        headers: { ...this.auth(await this.adminToken()), 'Idempotency-Key': randomUUID() },
        data: { ...input, teamId: await this.teamId() },
      }),
      `invite ${input.email}`,
    )
    const token = await this.invitationToken(input.email)
    const password = strongPassword()
    const enrollment = await json<Schemas['TotpEnrollment']>(
      await this.request.post(`${API}/onboarding/invitations/password`, {
        data: { token, password },
      }),
      `password of ${input.email}`,
    )
    await json(
      await this.request.post(`${API}/onboarding/invitations/activate`, {
        data: { token, code: totpCode(enrollment.secret) },
      }),
      `activate ${input.email}`,
    )
    return {
      id: invited.user.id,
      name: invited.user.name,
      email: invited.user.email,
      password,
      totpSecret: enrollment.secret,
      roles: input.roles,
      languages: input.languages,
    }
  }

  /** The newest emails of the dev mailbox (the backend runs with `CC_DEV_MAILBOX`). */
  async mailbox(): Promise<Schemas['DevEmail'][]> {
    const box = await json<Schemas['DevMailbox']>(
      await this.request.get(`${API}/dev/mailbox`, { params: { limit: 50 } }),
      'dev mailbox',
    )
    return box.items
  }

  /** The token of the newest invitation email sent to `email`. */
  async invitationToken(email: string): Promise<string> {
    const message = (await this.mailbox()).find(
      (item) => item.kind === 'invitation' && item.to === email,
    )
    if (!message) throw new Error(`no invitation email for ${email}`)
    const token = new URL(message.link).searchParams.get('token')
    if (!token) throw new Error(`the invitation of ${email} has no token`)
    return token
  }

  async adminUser(staffId: string): Promise<AdminUser> {
    return json<AdminUser>(
      await this.request.get(`${API}/admin/users/${staffId}`, {
        headers: this.auth(await this.adminToken()),
      }),
      `get user ${staffId}`,
    )
  }

  /** The account with this email (any status), as administration sees it. */
  async findUser(email: string): Promise<AdminUser> {
    const list = await json<Schemas['AdminUserList']>(
      await this.request.get(`${API}/admin/users`, {
        headers: this.auth(await this.adminToken()),
        params: { q: email, status: 'all' },
      }),
      `find ${email}`,
    )
    const user = list.items.find((item) => item.email === email)
    if (!user) throw new Error(`no account for ${email}`)
    return user
  }

  async setAvailability(person: CreatedPerson, status: 'available' | 'paused'): Promise<void> {
    const token = await this.signIn(person.email, person.password, person.totpSecret)
    await json(
      await this.request.put(`${API}/me/availability`, {
        headers: this.auth(token),
        data: { status },
      }),
      `availability ${person.email}`,
    )
  }

  /**
   * Cleanup: leaves a scenario's analyst "En pausa" so she takes no case from the
   * next scenario. Best effort: a deactivated or locked person cannot sign in, and
   * both are already out of the assignment.
   */
  async pauseQuietly(person: CreatedPerson): Promise<void> {
    this.forget(person.email)
    try {
      const user = await this.adminUser(person.id)
      if (user.status !== 'active' || user.availability !== 'available') return
      await this.setAvailability(person, 'paused')
    } catch {
      // Cleanup never fails a scenario.
    }
  }

  async demoCustomer(customerId: string): Promise<DemoCustomer> {
    const list = await json<Schemas['DemoCustomerList']>(
      await this.request.get(`${API}/customer/demo-customers`),
      'demo customers',
    )
    const customer = list.items.find((item) => item.id === customerId)
    if (!customer) throw new Error(`customer ${customerId} not found`)
    return customer
  }

  async caseDetail(caseId: string): Promise<CaseDetail> {
    return json<CaseDetail>(
      await this.request.get(`${API}/cases/${caseId}`, {
        headers: this.auth(await this.supervisorToken()),
      }),
      `case ${caseId}`,
    )
  }

  /**
   * Gives the scenario a customer with no open conversation. A conversation left
   * open (by an earlier attempt of the same scenario, or by the seed) is assigned
   * by supervision to `janitor` (a paused analyst who speaks both languages) and
   * closed by her. Returns how many closed conversations the customer has now.
   */
  async releaseCustomer(customerId: string, janitor: CreatedPerson): Promise<number> {
    const customer = await this.demoCustomer(customerId)
    const open = customer.openConversation
    if (!open) return customer.closedConversationCount
    const detail = await this.caseDetail(open.caseId)
    const assignee = detail.case.assignedAnalystId ?? null
    if (assignee !== janitor.id) {
      await json(
        await this.request.put(`${API}/supervision/cases/${open.caseId}/assignee`, {
          headers: this.auth(await this.supervisorToken()),
          data: { analystId: janitor.id, expectedAnalystId: assignee, confirmPaused: true },
        }),
        `move ${open.caseId} to the janitor`,
      )
    }
    await json(
      await this.request.post(`${API}/cases/${open.caseId}/close`, {
        headers: this.auth(await this.signIn(janitor.email, janitor.password, janitor.totpSecret)),
        data: { reason: 'other', note: 'e2e: conversación de un intento anterior' },
      }),
      `close ${open.caseId}`,
    )
    const after = await this.demoCustomer(customerId)
    expect(after.openConversation, `${customer.displayName} still has an open case`).toBeNull()
    return after.closedConversationCount
  }
}

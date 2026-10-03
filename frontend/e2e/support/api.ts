import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import type { components } from '../../src/lib/api/schema.gen'
import { API_URL } from './env'
import { DEMO_PASSWORD, DEV_MFA_CODE, SEEDED, TEAM_ANDES, type Language } from './data'

type Schemas = components['schemas']
export type StaffRole = Schemas['StaffRole']
export type AdminUser = Schemas['AdminUser']
export type DemoCustomer = Schemas['DemoCustomer']
export type CaseDetail = Schemas['CaseDetail']

/** A person created by a scenario: her id, credentials and the name the UI shows. */
export interface CreatedPerson {
  id: string
  name: string
  email: string
  password: string
  roles: StaffRole[]
  languages: Language[]
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

  /** Password + dev MFA → a staff session token (cached per email). */
  async signIn(email: string, password: string = DEMO_PASSWORD): Promise<string> {
    const cached = this.tokens.get(email)
    if (cached) return cached
    const login = await json<Schemas['LoginResponse']>(
      await this.request.post(`${API}/auth/login`, { data: { email, password } }),
      `login ${email}`,
    )
    const session = await json<Schemas['SessionResponse']>(
      await this.request.post(`${API}/auth/mfa`, {
        data: { challengeId: login.challengeId, code: DEV_MFA_CODE },
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

  async teamId(name: string = TEAM_ANDES): Promise<string> {
    const teams = await json<Schemas['AdminTeamList']>(
      await this.request.get(`${API}/admin/teams`, { headers: this.auth(await this.adminToken()) }),
      'list teams',
    )
    const team = teams.items.find((item) => item.name === name)
    if (!team) throw new Error(`team ${name} not found`)
    return team.id
  }

  /** Administration creates a person (starts "En pausa"); returns her temporary password. */
  async createPerson(input: {
    name: string
    email: string
    roles: StaffRole[]
    languages: Language[]
  }): Promise<CreatedPerson> {
    const created = await json<Schemas['CreatedUser']>(
      await this.request.post(`${API}/admin/users`, {
        headers: { ...this.auth(await this.adminToken()), 'Idempotency-Key': randomUUID() },
        data: { ...input, teamId: await this.teamId() },
      }),
      `create ${input.email}`,
    )
    if (!created.temporaryPassword) throw new Error('no temporary password returned')
    return {
      id: created.user.id,
      name: created.user.name,
      email: created.user.email,
      password: created.temporaryPassword,
      roles: input.roles,
      languages: input.languages,
    }
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
    const token = await this.signIn(person.email, person.password)
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
        headers: this.auth(await this.signIn(janitor.email, janitor.password)),
        data: { reason: 'other', note: 'e2e: conversación de un intento anterior' },
      }),
      `close ${open.caseId}`,
    )
    const after = await this.demoCustomer(customerId)
    expect(after.openConversation, `${customer.displayName} still has an open case`).toBeNull()
    return after.closedConversationCount
  }
}

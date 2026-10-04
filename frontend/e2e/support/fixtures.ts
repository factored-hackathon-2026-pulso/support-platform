import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { PlatformApi, type CreatedPerson, type StaffRole } from './api'
import { inventPerson, type DemoCustomerRef, type Language } from './data'
import { AppShell } from './pages/app-shell'
import { CustomerSimulatorPage, type SimulatorChannel } from './pages/customer-simulator-page'
import { LoginPage } from './pages/login-page'

/** One browser window per person in the scenario (own context: own session storage). */
export interface Actors {
  /** A fresh window with nobody signed in. */
  open(label: string): Promise<Page>
  /** A fresh window signed in through the UI (password + MFA) as this person. */
  signedIn(
    label: string,
    person: { name: string; email: string; password?: string; totpSecret?: string },
  ): Promise<{
    page: Page
    shell: AppShell
  }>
  /**
   * A fresh window on the customer simulator, already acting as this customer on a channel
   * (slice 12: the chat by default; "Llamar" dials at once).
   */
  customer(
    label: string,
    customer: DemoCustomerRef,
    channel?: SimulatorChannel,
  ): Promise<CustomerSimulatorPage>
}

export interface People {
  /**
   * Administration invites an analyst and she activates the invitation (password +
   * authenticator, through the API); starts "En pausa"; paused again after the test.
   */
  analyst(languages: Language[], extraRoles?: StaffRole[]): Promise<CreatedPerson>
  /** A person with exactly these roles. */
  person(roles: StaffRole[], languages: Language[]): Promise<CreatedPerson>
  /** A person the scenario invited and activated through the UI: paused again after the test too. */
  adopt(person: Omit<CreatedPerson, 'id'>): Promise<CreatedPerson>
}

export interface Customers {
  /**
   * Hands the scenario this customer with no open conversation (one left open is
   * closed by the janitor first). Returns her closed conversation count.
   */
  release(customer: DemoCustomerRef): Promise<number>
}

interface TestFixtures {
  actors: Actors
  people: People
  customers: Customers
}

interface WorkerFixtures {
  api: PlatformApi
  /** A paused es + pt analyst that only cleans up conversations left open. */
  janitor: CreatedPerson
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  api: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext()
      await use(new PlatformApi(request))
      await request.dispose()
    },
    { scope: 'worker' },
  ],

  janitor: [
    async ({ api }, use) => {
      await use(
        await api.createPerson({ ...inventPerson(), roles: ['analyst'], languages: ['es', 'pt'] }),
      )
    },
    { scope: 'worker' },
  ],

  // Screenshots and traces on failure come from the config (`use`): Playwright
  // captures every page of these contexts too.
  actors: async ({ browser, baseURL, viewport, locale, timezoneId }, use) => {
    const windows: { label: string; context: BrowserContext; errors: string[] }[] = []

    async function open(label: string): Promise<Page> {
      const context = await browser.newContext({ baseURL, viewport, locale, timezoneId })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
      windows.push({ label, context, errors })
      return page
    }

    await use({
      open,
      async signedIn(label, person) {
        const page = await open(label)
        await new LoginPage(page).signIn(person.email, person.password, person.totpSecret)
        const shell = new AppShell(page, person.name)
        await expect(shell.roleSwitcherButton).toBeVisible()
        return { page, shell }
      },
      async customer(label, customer, channel) {
        const simulator = new CustomerSimulatorPage(await open(label), customer)
        await simulator.open(channel)
        return simulator
      },
    })

    for (const { context } of windows) await context.close()
    // An uncaught error in any window fails the scenario, even when its assertions passed.
    const pageErrors = windows.flatMap(({ label, errors }) => errors.map((e) => `[${label}] ${e}`))
    expect(pageErrors, 'uncaught page errors').toEqual([])
  },

  people: async ({ api }, use) => {
    const created: CreatedPerson[] = []
    async function person(roles: StaffRole[], languages: Language[]) {
      const next = await api.createPerson({ ...inventPerson(), roles, languages })
      created.push(next)
      return next
    }
    await use({
      person,
      analyst: (languages, extraRoles = []) => person(['analyst', ...extraRoles], languages),
      async adopt(input) {
        const adopted = { ...input, id: (await api.findUser(input.email)).id }
        created.push(adopted)
        return adopted
      },
    })
    // Nobody a scenario made available may take the next scenario's cases.
    for (const next of created) await api.pauseQuietly(next)
  },

  customers: async ({ api, janitor }, use) => {
    await use({ release: (customer) => api.releaseCustomer(customer.id, janitor) })
  },
})

export { expect }

import type { Locator, Page } from '@playwright/test'
import { CUSTOMERS, escapeRegExp, firstName, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'

/**
 * A catalog key printed instead of its text ("status.new.label", "queues.tableLabel"): what a
 * namespace that was not loaded, or a missing key, shows (no fallback language, ADR 0008).
 * Emails and the example domain are taken out first.
 */
const RAW_KEY = /(?<![\w.@-])[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+(?![\w@-])/g

async function rawKeys(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap(
      (el) => ['aria-label', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? ''),
    )
    return [document.body.innerText, ...labels, document.title].join('\n')
  })
  const readable = text.replace(/\S+@\S+/g, ' ').replace(/\b\S+\.example\b/g, ' ')
  return [...new Set(readable.match(RAW_KEY) ?? [])]
}

/** The screen is up with this h1 and no key shows in place of a text. */
async function expectScreen(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  await expect.poll(() => rawKeys(page)).toEqual([])
}

async function goToRole(rail: Locator, name: string, role: string): Promise<void> {
  await rail.getByRole('button', { name: `${name}, trocar de perfil` }).click()
  await rail
    .getByRole('list', { name: 'Trocar de perfil' })
    .getByRole('link', { name: role })
    .click()
}

test.describe('Platform language (slice 23)', () => {
  test('a person switches the platform to Português from her account menu, and it stays after a reload and at the sign-in', async ({
    actors,
    people,
  }) => {
    // A throwaway admin: the seeded accounts never change.
    const admin = await people.person(['admin'], [])
    const { page, shell } = await actors.signedIn('administración', admin)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    // "Plataforma" is a migrated screen: it follows the language with the shell.
    await shell.rail.getByRole('link', { name: 'Plataforma' }).click()
    await expect(page.getByRole('switch', { name: 'Funciones de IA' })).toBeVisible()

    await shell.chooseLanguage('Português')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(shell.rail.getByRole('list', { name: 'Idioma da plataforma' })).toBeVisible()
    await expect(shell.rail.getByRole('link', { name: 'Usuários e perfis' })).toBeVisible()
    await expect(page.getByText('Ajustes para toda a equipe')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Funções de IA' })).toBeVisible()
    await expect(page).toHaveTitle('Plataforma · LATAM Bank Suporte')

    // Saved on her profile: a reload keeps it.
    await page.reload()
    await expect(page.getByText('Ajustes para toda a equipe')).toBeVisible()
    await expect(
      shell.rail.getByRole('button', { name: `${admin.name}, trocar de perfil` }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

    // Signed out, this browser remembers it for the sign-in screens.
    await shell.rail.getByRole('button', { name: `${admin.name}, trocar de perfil` }).click()
    await shell.rail.getByRole('button', { name: 'Sair' }).click()
    await expect(page.getByRole('form', { name: 'Entrar com e-mail' })).toBeVisible()
    await expect(page.getByText('Atendimento ao cliente por chat, do início ao fim.')).toBeVisible()
  })
})

test.describe('The platform in Portuguese (slice 23b)', () => {
  test('a person with every role walks the main screens of each one in Portuguese, server texts included', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.rafael // pt-BR
    await customers.release(customer)
    const person = await people.analyst(['pt'], ['supervisor', 'admin'])
    const { page, shell } = await actors.signedIn('equipe', person)
    await shell.chooseLanguage('Português')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    const rail = shell.rail

    // Analyst: Início, she starts working and the customer's case arrives.
    await page.goto('/analyst/home')
    await expectScreen(
      page,
      new RegExp(`^(Bom dia|Boa tarde|Boa noite), ${escapeRegExp(firstName(person.name))}$`),
    )
    const availability = page.getByRole('region', { name: 'Sua disponibilidade' })
    await expect(availability).toContainText('Você está em pausa')
    await availability.getByRole('button', { name: 'Começar a atender' }).click()
    await expect(availability).toContainText('Você está disponível')
    await expect(rail.getByText('Status: Disponível')).toBeAttached()

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Olá, não reconheço uma compra no meu cartão')
    await chat.send(text)
    await expect(chat.status({ agent: firstName(person.name) })).toBeVisible()
    const first = page.getByRole('region', { name: 'Prioridades' })
    const row = first.getByRole('listitem').filter({ hasText: customer.name })
    await expect(row).toContainText('Novo')
    await expect.poll(() => rawKeys(page)).toEqual([])

    // Casos, with her case open.
    await first.getByRole('link', { name: `Abrir o caso de ${customer.name}` }).click()
    await expect(page).toHaveURL(/\/analyst\/cases\?case=CASE-/)
    const conversation = page.getByRole('region', { name: `Conversa com ${customer.name}` })
    await expect(conversation.getByRole('heading', { level: 2, name: customer.name })).toBeVisible()
    await expect(conversation.getByText(text)).toBeVisible()
    // Slice 23c: the staff-only line is written from its facts in her language.
    await expect(
      conversation.getByText(
        `Atribuído a ${person.name} porque está disponível e fala português (regra 3).`,
      ),
    ).toBeVisible()
    await expect(conversation.getByText(/Asignado a .* porque está disponible/)).toHaveCount(0)
    await expect(
      conversation.getByRole('textbox', { name: 'Escreva para o cliente' }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Casos abertos' })).toBeVisible()
    await expect.poll(() => rawKeys(page)).toEqual([])
    const caseUrl = page.url()

    // A reload of the case is a cold start: every catalog loads again, in Portuguese.
    await page.reload()
    await expect(conversation.getByText(text)).toBeVisible()
    await expect.poll(() => rawKeys(page)).toEqual([])

    // Supervisão: Filas (her case in the Portuguese queue), Equipe, Escalados.
    await goToRole(rail, person.name, 'Supervisão')
    await expectScreen(page, 'Filas')
    await page.goto('/supervision/queues?language=pt')
    await expectScreen(page, 'Filas')
    await expect(page.getByRole('table', { name: 'Casos abertos em português' })).toContainText(
      customer.name,
    )
    await rail.getByRole('link', { name: /^Equipe/ }).click()
    await expectScreen(page, 'Equipe')
    await rail.getByRole('link', { name: /^Escalados/ }).click()
    await expectScreen(page, 'Escalados')
    await rail.getByRole('link', { name: /^Auditoria/ }).click()
    await expectScreen(page, 'Auditoria')
    // Slice 23c: "O que fez" is rendered by the server in her language.
    const caseId = new URL(caseUrl).searchParams.get('case') ?? ''
    await page.goto(`/supervision/audit?case=${caseId}`)
    await expectScreen(page, 'Auditoria')
    const events = page.getByRole('table', { name: 'Eventos' })
    await expect(
      events.getByRole('row', {
        name: new RegExp(
          escapeRegExp(
            `Atribuiu o caso a ${person.name}: estava disponível e fala português (regra 3)`,
          ),
        ),
      }),
    ).toBeVisible()
    await expect(events.getByRole('row', { name: /Escreveu uma mensagem/ }).first()).toBeVisible()
    await expect(events.getByText(/Asignó el caso/)).toHaveCount(0)

    // Administração: Usuários e perfis, Equipes, Plataforma.
    await goToRole(rail, person.name, 'Administração')
    await expectScreen(page, 'Usuários e perfis')
    await rail.getByRole('link', { name: /^Equipes/ }).click()
    await expectScreen(page, 'Equipes')
    await rail.getByRole('link', { name: /^Plataforma/ }).click()
    await expectScreen(page, 'Plataforma')
    await expect(page.getByRole('switch', { name: 'Funções de IA' })).toBeVisible()

    // Back to her case: still hers, still in Portuguese.
    await page.goto(caseUrl)
    await expect(conversation.getByText(text)).toBeVisible()
    await expect.poll(() => rawKeys(page)).toEqual([])
  })
})

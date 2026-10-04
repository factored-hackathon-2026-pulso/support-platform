import { CUSTOMERS, firstName, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { HomePage } from './support/pages/home-page'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Analyst home ("Inicio")', () => {
  test('she lands on Inicio, starts working, a queued case arrives and she opens it from "Lo primero"', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.lucas
    await customers.release(customer)
    const analyst = await people.analyst(['es'])

    // The customer writes while nobody who speaks Spanish is available: the case waits.
    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Hola, tengo un cargo que no reconozco')
    await chat.send(text)
    await expect(chat.status('searching')).toBeVisible()

    // She signs in and lands on "Inicio", paused.
    const { page } = await actors.signedIn('analista', analyst)
    await expect(page).toHaveURL(/\/analista\/inicio$/)
    const home = new HomePage(page)
    await expect(home.greeting(firstName(analyst.name))).toBeVisible()
    await expect(home.availability).toContainText('Estás en pausa')
    await expect(home.availability).toContainText('Sin casos nuevos')
    const rail = page.getByRole('navigation', { name: 'Principal' })
    await expect(rail.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await expect(rail.getByText('Estado: En pausa')).toBeAttached()
    await expect(home.firstCase(customer.name)).toHaveCount(0)
    await expect(home.team).toContainText('Cola en español')

    // "Empezar a atender": the queue drains to her, live.
    await home.startWorking()
    await expect(rail.getByText('Estado: Disponible')).toBeAttached()
    await expect(chat.status({ agent: firstName(analyst.name) })).toBeVisible()
    await expect(home.firstCase(customer.name)).toContainText('Nuevo')
    await expect(home.firstCase(customer.name)).toContainText(text)
    await expect(home.feedRow('Te llegó desde la cola', customer.name)).toBeVisible()
    await expect(home.tile('Nuevos')).not.toHaveAccessibleName(/^0 /)

    // "Abrir": Casos with that case open and its card highlighted under its filter.
    await home.openFirstCase(customer.name)
    await expect(page).toHaveURL(/\/analista\?caso=CASE-[^&]+&estado=nuevos$/)
    const workspace = new WorkspacePage(page)
    await expect(workspace.filterChip('Nuevos')).toBeVisible()
    await expect(workspace.caseCard(customer.name)).toHaveAttribute('aria-current', 'true')
    const conversation = workspace.conversation(customer.name)
    await expect(conversation.getByRole('heading', { level: 2, name: customer.name })).toBeVisible()
    await expect(workspace.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
    await expect(rail.getByRole('link', { name: /^Casos/ })).toHaveAttribute('aria-current', 'page')

    // She answers from Casos; the customer reads it.
    const reply = uniqueText('Hola, Lucas. Ya reviso ese cargo')
    await workspace.reply(customer.name, reply)
    await expect(chat.messages.filter({ hasText: reply })).toHaveCount(1)
  })
})

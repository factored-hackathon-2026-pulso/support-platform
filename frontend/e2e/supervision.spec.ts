import { CUSTOMERS, firstName, SEEDED, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { HomePage } from './support/pages/home-page'
import { SupervisorCasePage, TeamPage } from './support/pages/supervision-pages'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Colas y supervisión', () => {
  test('a case nobody eligible can take waits in its queue and drains to the first eligible analyst', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.rafael // pt-BR
    await customers.release(customer)
    const spanishOnly = await people.analyst(['es'])
    const portuguese = await people.analyst(['pt'])

    // Someone IS available, but she does not speak Portuguese (rule 3).
    const es = await actors.signedIn('analista es', spanishOnly)
    const esWorkspace = new WorkspacePage(es.page)
    await esWorkspace.goto()
    await esWorkspace.becomeAvailable()

    const supervisor = await actors.signedIn('supervisora', SEEDED.supervisor)
    const team = new TeamPage(supervisor.page)
    await team.goto()

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Olá, não reconheço uma compra no meu cartão')
    await chat.send(text)

    // Queued: the customer waits, supervision sees it live, the Spanish speaker never gets it.
    await expect(chat.status('searching')).toBeVisible()
    await expect(team.queuedCase('Cola en portugués', customer.name)).toBeVisible()
    await expect(team.queuedCase('Cola en portugués', customer.name)).toContainText(text)
    await expect(esWorkspace.caseCard(customer.name)).toHaveCount(0)

    // A Portuguese speaker becomes available: the queue drains to her.
    const pt = await actors.signedIn('analista pt', portuguese)
    const ptWorkspace = new WorkspacePage(pt.page)
    await ptWorkspace.goto()
    await expect(ptWorkspace.caseCard(customer.name)).toHaveCount(0)
    await ptWorkspace.becomeAvailable()

    await expect(ptWorkspace.caseCard(customer.name)).toBeVisible()
    await expect(chat.status({ agent: firstName(portuguese.name) })).toBeVisible()
    await expect(team.queuedCase('Cola en portugués', customer.name)).toHaveCount(0)
    await ptWorkspace.openCase(customer.name)
    await expect(ptWorkspace.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
    await expect(esWorkspace.caseCard(customer.name)).toHaveCount(0)
  })

  test('a supervisor assigns a queued case and reassigns it while the analyst watches (rule 3 in the dialog)', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.gabriela // pt-BR
    await customers.release(customer)
    const holder = await people.analyst(['es', 'pt'])
    const next = await people.analyst(['pt'])
    const spanishOnly = await people.analyst(['es'])

    // The first analyst is signed in, paused: she only gets this case by hand.
    const analyst = await actors.signedIn('analista', holder)
    const inbox = new WorkspacePage(analyst.page)
    await inbox.goto()

    const supervisor = await actors.signedIn('supervisora', SEEDED.supervisor)
    const team = new TeamPage(supervisor.page)
    await team.goto()

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Alguém pode me ajudar com uma cobrança?')
    await chat.send(text)
    await expect(chat.status('searching')).toBeVisible()

    const queued = team.queuedCase('Cola en portugués', customer.name)
    await expect(queued).toContainText(text)
    const href = await queued
      .getByRole('link', { name: customer.name, exact: true })
      .getAttribute('href')
    const caseId = href?.split('/').pop() ?? ''
    expect(caseId).toMatch(/^CASE-/)

    // Assign: a Spanish-only analyst is listed but cannot be chosen (rule 3).
    const assign = await team.openAssignDialog('Cola en portugués', customer.name)
    await expect(assign.candidate(spanishOnly.name)).toBeDisabled()
    await expect(assign.candidate(spanishOnly.name)).toHaveAccessibleDescription(
      'No habla portugués (regla 3)',
    )
    await expect(assign.candidate(holder.name)).toBeEnabled()
    await assign.choose(holder.name, { confirmPaused: true })
    await assign.submit(new RegExp(`^Asignar a ${firstName(holder.name)}$`))

    // Live: out of the queue, into her list, and the customer has a person.
    await expect(queued).toHaveCount(0)
    await expect(inbox.caseCard(customer.name)).toBeVisible()
    await expect(analyst.shell.toast('Te asignaron un caso')).toBeVisible()
    await expect(analyst.shell.toast(customer.name)).toBeVisible()
    await expect(analyst.shell.toast('Supervisión')).toBeVisible()
    await expect(chat.status({ agent: firstName(holder.name) })).toBeVisible()
    await inbox.openCase(customer.name)
    await expect(inbox.messages(customer.name).filter({ hasText: text })).toHaveCount(1)

    // Reassign from the supervisor's read-only case view.
    const caseView = new SupervisorCasePage(supervisor.page)
    await caseView.goto(caseId, customer.name)
    const reassign = await caseView.openReassignDialog()
    await expect(reassign.candidate(spanishOnly.name)).toBeDisabled()
    await reassign.choose(next.name, { confirmPaused: true })
    const notice = `Agora quem te atende é ${firstName(next.name)}, da nossa equipe.`
    await expect(reassign.root.getByText(notice)).toBeVisible()
    await reassign.submit(new RegExp(`^Reasignar a ${firstName(next.name)}$`))

    // The first analyst watches it leave her list; the customer is told who took over.
    await expect(inbox.caseCard(customer.name)).toHaveCount(0)
    await expect(analyst.shell.toast('Supervisión reasignó un caso')).toBeVisible()
    await expect(chat.status({ agent: firstName(next.name) })).toBeVisible()
    await expect(chat.messages.filter({ hasText: notice })).toHaveCount(1)

    // On Inicio, "Mientras no estabas" says who took it; the row opens it read-only
    // in Casos (history access: she held it).
    const home = new HomePage(analyst.page)
    await home.goto()
    const given = home.feedRow('Te lo asignaron', customer.name)
    await expect(given).toBeVisible()
    await expect(given).toContainText(SEEDED.supervisor.name)
    const away = home.feedRow('Ya no es tuyo', customer.name)
    await expect(away).toContainText(SEEDED.supervisor.name)
    await expect(away).toContainText(next.name)
    await expect(away).toContainText('Solo lectura')
    await away.click()
    await expect(analyst.page).toHaveURL(new RegExp(`/analista\\?caso=${caseId}$`))
    const readOnly = inbox.conversation(customer.name).getByRole('note', { name: 'Solo lectura' })
    await expect(readOnly).toContainText(`Lo atiende ${next.name}`)
    await expect(inbox.composer(customer.name)).toHaveCount(0)
    await expect(inbox.messages(customer.name).filter({ hasText: text })).toHaveCount(1)

    // The new assignee has it.
    const second = await actors.signedIn('analista nueva', next)
    const secondInbox = new WorkspacePage(second.page)
    await secondInbox.goto()
    await secondInbox.openCase(customer.name)
    await expect(secondInbox.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
  })
})

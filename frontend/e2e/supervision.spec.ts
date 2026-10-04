import { CUSTOMERS, firstName, SEEDED, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { HomePage } from './support/pages/home-page'
import { EscalationsPage, QueuesPage, SupervisorCasePage } from './support/pages/supervision-pages'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Colas y supervisión', () => {
  test('a case nobody eligible can take waits in Colas and drains to the first eligible analyst', async ({
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

    const supervisor = await actors.signedIn('supervisión', SEEDED.supervisor)
    const queues = new QueuesPage(supervisor.page)
    await queues.goto('Portugués')

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Olá, não reconheço uma compra no meu cartão')
    await chat.send(text)

    // Nobody holds it: the customer waits, supervision sees it live (no "Asignar": it is
    // automatic), the Spanish speaker never gets it.
    await expect(chat.status('searching')).toBeVisible()
    const row = queues.caseRow('Portugués', customer.name)
    await expect(row).toBeVisible()
    await expect(row.getByText('Sin asignar').first()).toBeVisible()
    await expect(row.getByRole('button', { name: /Asignar/ })).toHaveCount(0)
    await expect(esWorkspace.caseCard(customer.name)).toHaveCount(0)

    // A Portuguese speaker becomes available: the queue drains to her.
    const pt = await actors.signedIn('analista pt', portuguese)
    const ptWorkspace = new WorkspacePage(pt.page)
    await ptWorkspace.goto()
    await expect(ptWorkspace.caseCard(customer.name)).toHaveCount(0)
    await ptWorkspace.becomeAvailable()

    await expect(ptWorkspace.caseCard(customer.name)).toBeVisible()
    await expect(chat.status({ agent: firstName(portuguese.name) })).toBeVisible()
    await expect(row).toContainText(portuguese.name)
    await ptWorkspace.openCase(customer.name)
    await expect(ptWorkspace.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
    await expect(esWorkspace.caseCard(customer.name)).toHaveCount(0)
  })

  test('a supervisor reassigns an open case while the analyst watches (only speakers in the dialog)', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.gabriela // pt-BR
    await customers.release(customer)
    const holder = await people.analyst(['es', 'pt'])
    const next = await people.analyst(['pt'])
    const spanishOnly = await people.analyst(['es'])

    // The first analyst is available: the case reaches her on its own.
    const analyst = await actors.signedIn('analista', holder)
    const inbox = new WorkspacePage(analyst.page)
    await inbox.goto()
    await inbox.becomeAvailable()

    const supervisor = await actors.signedIn('supervisión', SEEDED.supervisor)
    const queues = new QueuesPage(supervisor.page)
    await queues.goto('Portugués')

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Alguém pode me ajudar com uma cobrança?')
    await chat.send(text)
    await expect(inbox.caseCard(customer.name)).toBeVisible()
    await expect(chat.status({ agent: firstName(holder.name) })).toBeVisible()

    const row = queues.caseRow('Portugués', customer.name)
    await expect(row).toContainText(holder.name)
    const href = await row
      .getByRole('link', { name: customer.name, exact: true })
      .getAttribute('href')
    const caseId = href?.split('/').pop() ?? ''
    expect(caseId).toMatch(/^CASE-/)
    await inbox.openCase(customer.name)
    await expect(inbox.messages(customer.name).filter({ hasText: text })).toHaveCount(1)

    // Reassign from the supervisor's read-only case view (the row opens it).
    await row.getByRole('link', { name: customer.name, exact: true }).click()
    const caseView = new SupervisorCasePage(supervisor.page)
    await expect(supervisor.page.getByRole('link', { name: 'Volver a Colas' })).toBeVisible()
    await caseView.goto(caseId, customer.name)
    const reassign = await caseView.openReassignDialog()
    // Rule 3: a Spanish-only analyst is never listed, even searching for her.
    await reassign.includeAway()
    await reassign.search(spanishOnly.name)
    await expect(reassign.candidate(spanishOnly.name)).toHaveCount(0)
    await expect(reassign.root.getByText('Nadie con ese nombre habla portugués.')).toBeVisible()
    await reassign.search(next.name)
    await reassign.choose(next.name, { confirmPaused: true })
    const notice = `Agora quem te atende é ${firstName(next.name)}, da nossa equipe.`
    await expect(reassign.root.getByText(notice)).toBeVisible()
    await reassign.submit(new RegExp(`^Reasignar a ${firstName(next.name)}$`))

    // The first analyst watches it leave her list; the customer is told who took over.
    await expect(inbox.caseCard(customer.name)).toHaveCount(0)
    await expect(analyst.shell.toast('Supervisión reasignó un caso')).toBeVisible()
    await expect(chat.status({ agent: firstName(next.name) })).toBeVisible()
    await expect(chat.messages.filter({ hasText: notice })).toHaveCount(1)

    // On Inicio, "Mientras no estabas" says who took it; the row opens it read-only in Casos.
    const home = new HomePage(analyst.page)
    await home.goto()
    const away = home.feedRow('Ya no es tuyo', customer.name)
    await expect(away).toContainText(SEEDED.supervisor.name)
    await expect(away).toContainText(next.name)
    await away.click()
    await expect(analyst.page).toHaveURL(new RegExp(`/analista\\?caso=${caseId}$`))
    const readOnly = inbox.conversation(customer.name).getByRole('note', { name: 'Solo lectura' })
    await expect(readOnly).toContainText(`Lo atiende ${next.name}`)
    await expect(inbox.composer(customer.name)).toHaveCount(0)

    // The new assignee has it.
    const second = await actors.signedIn('analista nueva', next)
    const secondInbox = new WorkspacePage(second.page)
    await secondInbox.goto()
    await secondInbox.openCase(customer.name)
    await expect(secondInbox.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
  })

  test('an analyst escalates, supervision answers from Escalados and she sees the answer live', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.lucas // es-AR
    await customers.release(customer)
    const person = await people.analyst(['es'])

    const analyst = await actors.signedIn('analista', person)
    const inbox = new WorkspacePage(analyst.page)
    await inbox.goto()
    await inbox.becomeAvailable()

    const chat = await actors.customer('cliente', customer)
    await chat.send(uniqueText('Me cobraron dos veces la misma compra'))
    await expect(inbox.caseCard(customer.name)).toBeVisible()
    await inbox.openCase(customer.name)

    // Supervision is on Escalados before it happens: the row arrives live.
    const supervisor = await actors.signedIn('supervisión', SEEDED.supervisor)
    const escalations = new EscalationsPage(supervisor.page)
    await escalations.goto()

    const motive = uniqueText('Le cobraron dos veces la misma compra y pide supervisión')
    const card = await inbox.escalate(customer.name, motive)
    await expect(card).toContainText(motive)
    await expect(inbox.caseCard(customer.name).getByText('Escalado')).toBeVisible()

    await expect(escalations.row(customer.name)).toBeVisible()
    await expect(escalations.row(customer.name)).toContainText(person.name)
    // No toast on Escalados itself (the row is the news); the rail badge counts it.
    await expect(supervisor.shell.toast(`${person.name} escaló un caso`)).toHaveCount(0)

    const note = uniqueText('Revisé el cobro: sigue tú con el cliente')
    await escalations.answer(customer.name, note)
    await expect(escalations.panel(customer.name).getByText('Respondiste a')).toBeVisible()

    // The analyst sees it live: a toast and the answer card in the case, then "Entendido".
    await expect(
      analyst.shell.toast(`${SEEDED.supervisor.name} respondió tu escalamiento`),
    ).toBeVisible()
    await expect(card.getByText(`${SEEDED.supervisor.name} respondió`)).toBeVisible()
    await expect(card.getByText(note)).toBeVisible()
    await expect(inbox.caseCard(customer.name).getByText('Escalado')).toHaveCount(0)
    await inbox.acknowledgeEscalation(customer.name)
    // The case stayed with her and she can escalate again.
    await expect(inbox.composer(customer.name)).toBeVisible()
    await expect(inbox.escalateButton(customer.name)).toBeVisible()
  })
})

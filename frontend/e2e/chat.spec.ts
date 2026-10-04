import { anyOf, containing, CUSTOMERS, firstName, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { WorkspacePage } from './support/pages/workspace-page'

const CLOSED_NOTICE_ES =
  'La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una nueva conversación.'

test.describe('Chat en vivo · analista ↔ cliente', () => {
  test('two windows talk live both ways and a reload keeps the order', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.natalia
    await customers.release(customer)
    const analyst = await people.analyst(['es'])

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()

    const chat = await actors.customer('cliente', customer)
    const first = uniqueText('Hola, no reconozco un cargo de mi tarjeta')
    await chat.send(first)

    // Rule 3: the only available Spanish speaker gets it on arrival, live in her list.
    await expect(chat.status({ agent: firstName(analyst.name) })).toBeVisible()
    await expect(workspace.caseCard(customer.name)).toContainText('Nuevo')
    await workspace.openCase(customer.name)
    await expect(workspace.messages(customer.name).filter({ hasText: first })).toHaveCount(1)

    // Analyst → customer, live.
    const reply = uniqueText('Hola, Natalia. Con gusto reviso ese cargo contigo')
    await workspace.reply(customer.name, reply)
    await expect(chat.messages.filter({ hasText: reply })).toHaveCount(1)

    // Customer → analyst, live (no reload, no polling on her side).
    const second = uniqueText('Fue una compra de ayer en la noche')
    await chat.send(second)
    await expect(workspace.messages(customer.name).filter({ hasText: second })).toHaveCount(1)
    await expect(workspace.caseCard(customer.name)).toContainText('Por responder')

    const ours = anyOf(first, reply, second)
    const order = [first, reply, second]
    await expect(workspace.messages(customer.name).filter({ hasText: ours })).toHaveText(
      order.map(containing),
    )
    await expect(chat.messages.filter({ hasText: ours })).toHaveText(order.map(containing))

    // A reload of either window rebuilds the same transcript in the same order.
    await page.reload()
    await chat.page.reload()
    await expect(workspace.conversation(customer.name)).toBeVisible()
    await expect(workspace.messages(customer.name).filter({ hasText: ours })).toHaveText(
      order.map(containing),
    )
    await expect(chat.messages.filter({ hasText: ours })).toHaveText(order.map(containing))
    await expect(chat.status({ agent: firstName(analyst.name) })).toBeVisible()
  })

  test('closing with a reason, then a new linked case and "Casos anteriores"', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.ximena
    const closedBefore = await customers.release(customer)
    const analyst = await people.analyst(['es'])

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()

    const chat = await actors.customer('cliente', customer)
    const question = uniqueText('Me cobraron dos veces la misma compra')
    await chat.send(question)
    await workspace.openCase(customer.name)
    const answer = uniqueText('Ya quedó reversado el cobro duplicado')
    await workspace.reply(customer.name, answer)
    await expect(chat.messages.filter({ hasText: answer })).toHaveCount(1)

    const note = uniqueText('Reverso confirmado con la clienta')
    await workspace.closeCase(customer.name, 'Resuelto', note)

    // The customer sees the closing notice, never the reason or the internal note.
    await expect(chat.status('ended')).toBeVisible()
    await expect(chat.messages.filter({ hasText: CLOSED_NOTICE_ES })).toHaveCount(1)
    await expect(chat.page.getByText(note)).toHaveCount(0)
    await expect(chat.page.getByText('Resuelto')).toHaveCount(0)

    // The analyst: out of "Todos", in "Cerrados" (read-only, with the reason).
    await expect(workspace.caseCard(customer.name)).toHaveCount(0)
    await workspace.showFilter('Cerrados')
    await expect(workspace.caseCard(customer.name)).toContainText('Resuelto')
    await workspace.openCase(customer.name)
    await expect(workspace.composer(customer.name)).toHaveCount(0)
    await expect(
      workspace.conversation(customer.name).getByRole('button', { name: 'Cerrar caso' }),
    ).toHaveCount(0)

    // Writing again opens a NEW case, linked to the closed one, assigned normally.
    const again = uniqueText('Hola de nuevo, me llegó otro cobro raro')
    await chat.send(again)
    await expect(chat.status({ agent: firstName(analyst.name) })).toBeVisible()
    await workspace.showFilter('Todos')
    await expect(workspace.caseCard(customer.name)).toContainText('Volvió a escribir')
    await workspace.openCase(customer.name)
    await expect(workspace.messages(customer.name).filter({ hasText: again })).toHaveCount(1)
    await expect(workspace.messages(customer.name).filter({ hasText: question })).toHaveCount(0)

    // "Ficha del cliente" › "Casos anteriores (n)": the closed case and its
    // read-only transcript, in the right panel; the conversation stays usable.
    const previous = closedBefore + 1
    const panel = await workspace.openCustomerFile(customer.name)
    await expect(panel.getByRole('region', { name: 'Cliente' })).toContainText(customer.name)
    await expect(panel.getByRole('region', { name: 'Este caso' })).toContainText('Chat en la app')
    await expect(panel.getByRole('region', { name: 'Cómo llegó a ti' })).toContainText(
      'Estabas disponible',
    )
    const sheet = panel.getByRole('region', { name: `Casos anteriores (${previous})` })
    await expect(sheet).toBeVisible()
    const rows = sheet.getByRole('list', { name: 'Casos anteriores' }).getByRole('listitem')
    await expect(rows).toHaveCount(previous)
    const closedRow = rows.filter({ hasText: 'Resuelto' }).filter({ hasText: analyst.name })
    await expect(closedRow).toHaveCount(1)
    await closedRow.getByRole('button').click()
    const transcript = sheet.getByRole('list', { name: 'Mensajes del caso anterior' })
    await expect(transcript.getByRole('listitem').filter({ hasText: question })).toHaveCount(1)
    await expect(transcript.getByRole('listitem').filter({ hasText: answer })).toHaveCount(1)
    await expect(sheet.getByText(`Nota: ${note}`)).toBeVisible()
    await expect(sheet.getByRole('textbox')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Todos los casos anteriores' }).click()
    await expect(rows).toHaveCount(previous)
    await expect(workspace.composer(customer.name)).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // The customer's side keeps the closed conversation too (after a reload, on demand).
    await chat.page.reload()
    await expect(chat.own(again)).toHaveCount(1)
    const past = await chat.showPastConversations()
    // Oldest at the top: the conversation this scenario closed is the last block.
    await past.getByRole('button', { expanded: false }).last().click()
    await expect(past.getByRole('listitem').filter({ hasText: answer })).toHaveCount(1)
  })

  test('the customer rates the closed conversation and the analyst sees it (slice 7)', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.andres
    await customers.release(customer)
    const analyst = await people.analyst(['es'])

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()

    const chat = await actors.customer('cliente', customer)
    await chat.send(uniqueText('Hola, quiero revisar un cobro'))
    await workspace.openCase(customer.name)
    const answer = uniqueText('Listo, ya quedó revisado el cobro')
    await workspace.reply(customer.name, answer)
    await expect(chat.messages.filter({ hasText: answer })).toHaveCount(1)
    await workspace.closeCase(customer.name, 'Resuelto')

    // The analyst opens the closed case: no rating yet.
    await workspace.showFilter('Cerrados')
    await workspace.openCase(customer.name)
    const footer = workspace.readOnlyFooter(customer.name)
    await expect(footer).toContainText('Resuelto')
    await expect(footer).not.toContainText('calificó')
    await expect(workspace.caseCard(customer.name)).not.toHaveAccessibleName(/Calificación/)

    // The survey takes the composer's place in the customer's window.
    await expect(chat.status('ended')).toBeVisible()
    await expect(chat.survey(firstName(analyst.name))).toBeVisible()
    await expect(chat.page.getByRole('textbox', { name: 'Escribe tu mensaje' })).toHaveCount(0)
    const comment = uniqueText('Muy clara la explicación')
    await chat.rate('Excelente', comment)
    await expect(chat.page.getByRole('textbox', { name: 'Escribe tu mensaje' })).toBeVisible()

    // Live in the analyst's window: the footer pill with the comment, the card's face.
    await expect(footer.getByText('El cliente calificó: Excelente')).toBeVisible()
    await expect(footer).toContainText(`“${comment}”`)
    await expect(workspace.caseCard(customer.name)).toHaveAccessibleName(/Calificación: Excelente/)
    const panel = await workspace.openCustomerFile(customer.name)
    await expect(panel.getByRole('region', { name: 'Este caso' })).toContainText(
      'CalificaciónExcelente',
    )

    // Rated once: a reload thanks again and never asks for this conversation.
    await chat.page.reload()
    await expect(chat.thanks('Excelente')).toBeVisible()
    await expect(chat.survey()).toHaveCount(0)
  })
})

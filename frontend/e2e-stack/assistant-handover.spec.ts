import { firstName, uniqueText } from '../e2e/support/data'
import { ACCOUNTS, LINKED } from './support/accounts'
import { expect, test } from './support/fixtures'
import { SCRIPTS, converseUntil, holdWithAssistant, snap } from './support/scenarios'

const natalia = LINKED.natalia
const analystFirstName = firstName(ACCOUNTS.analyst.name)

test.describe('From the assistant to people (stack)', () => {
  test('2 · "Hablar con una persona" hands the conversation to an available analyst', async ({
    stack,
    chatAs,
    availableAnalyst,
  }) => {
    const workspace = await availableAnalyst()
    const chat = await chatAs('cliente', natalia)
    await holdWithAssistant(chat, stack)
    const assistantTurns = await chat.assistantTurns.count()
    expect(assistantTurns).toBeGreaterThan(0)

    // The customer asks for a person: Tomás is available, so the case reaches him at once.
    await chat.askPersonButton.click()
    await expect(chat.status({ agent: analystFirstName })).toBeVisible({ timeout: 30_000 })
    await expect(chat.askPersonButton).toHaveCount(0)
    await expect(chat.notice(chat.assistantCopy.handoverNotice)).toHaveCount(1)
    // The assistant's turns stay in the transcript.
    await expect(chat.assistantTurns).toHaveCount(assistantTurns)

    // Tomás: the case arrives "tras el traspaso del asistente", with the staff-only banner and
    // the assistant's turns.
    await expect(workspace.caseCard(natalia.name)).toBeVisible({ timeout: 30_000 })
    const conversation = await workspace.openCase(natalia.name)
    await expect(
      conversation.getByText('Tras el traspaso del asistente', { exact: true }),
    ).toBeVisible()
    const transcript = workspace.messages(natalia.name)
    await expect(
      transcript.filter({ hasText: 'El cliente pidió hablar con una persona.' }),
    ).toHaveCount(1)
    await expect(transcript.filter({ hasText: 'Asistente virtual' })).toHaveCount(assistantTurns)
    // No packet behind a customer's request: no handoff card.
    await expect(
      conversation.getByRole('region', { name: 'El asistente te pasó este caso' }),
    ).toHaveCount(0)

    // He answers; the customer reads him.
    const reply = uniqueText('Hola Natalia, soy Tomás y sigo con tu caso')
    await workspace.reply(natalia.name, reply)
    const answer = chat.messages.filter({ hasText: reply })
    await expect(answer).toHaveCount(1)
    await expect(answer).toContainText(`${analystFirstName}, de LATAM Bank`)
    await snap(workspace.page, 'analyst-after-customer-request')
    await snap(chat.page, 'simulator-with-analyst')

    await workspace.closeCase(natalia.name, 'Resuelto')
  })

  test('3 · an escalation brings the handoff card, the "Traspaso" tab and "¿Te sirvió el traspaso?"', async ({
    stack,
    chatAs,
    availableAnalyst,
  }) => {
    const workspace = await availableAnalyst()
    const chat = await chatAs('cliente', natalia)
    // A charge over the amount policy: the assistant escalates with a handoff packet.
    const outcome = await converseUntil(chat, stack, SCRIPTS.largeDispute, async ({ state }) => {
      const conversation = state.conversation
      if (!conversation || !['waiting_agent', 'with_agent'].includes(conversation.status)) {
        return false
      }
      return stack.hasHandoff(conversation.caseId, ACCOUNTS.analyst)
    })
    const caseId = outcome.state.conversation?.caseId ?? ''
    await expect(chat.status({ agent: analystFirstName })).toBeVisible({ timeout: 30_000 })

    await expect(workspace.caseCard(natalia.name)).toBeVisible({ timeout: 30_000 })
    const conversation = await workspace.openCase(natalia.name)
    await expect(
      conversation.getByText('Tras el traspaso del asistente', { exact: true }),
    ).toBeVisible()
    await expect(
      workspace.messages(natalia.name).filter({
        hasText: /^Nota interna: El asistente escaló el caso a una persona \(traspaso /,
      }),
    ).toHaveCount(1)

    // The card on top of the conversation: why, the priority it saw, "Solo el equipo".
    const card = conversation.getByRole('region', { name: 'El asistente te pasó este caso' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByText('Solo el equipo')).toBeVisible()
    await expect(card).toContainText('Por qué te lo pasó')
    await expect(card).toContainText('Prioridad que vio el asistente')
    await snap(workspace.page, 'handoff-card')

    // "Ver todo" opens the "Traspaso" tab of "Apoyo del caso".
    await card.getByRole('button', { name: 'Ver todo el traspaso del asistente' }).click()
    const panel = workspace.customerPanel()
    await expect(panel).toHaveAccessibleName('Apoyo del caso')
    await expect(panel.getByRole('tab', { name: 'Traspaso' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (const section of [
      'Por qué te lo pasó',
      'Verificado',
      'Dice el cliente, sin verificar',
      'Lo que hizo el asistente',
      'Falta resolver',
      'Qué pide',
    ]) {
      await expect(panel.getByRole('region', { name: section })).toBeVisible()
    }
    await expect(
      panel.getByText(
        'Lo armó el asistente virtual con su conversación. Revísalo antes de responder.',
      ),
    ).toBeVisible()
    await snap(workspace.page, 'traspaso-tab')

    // Closing asks "¿Te sirvió el traspaso del asistente?"; "Útil" travels with the close.
    await conversation.getByRole('button', { name: 'Cerrar caso' }).click()
    const dialog = workspace.page.getByRole('dialog', { name: 'Cerrar caso' })
    const question = dialog.getByRole('group', {
      name: '¿Te sirvió el traspaso del asistente? (opcional)',
    })
    await expect(question).toBeVisible()
    const useful = question.getByRole('button', { name: /^Útil/ })
    await useful.click()
    await expect(useful).toHaveAttribute('aria-pressed', 'true')
    await snap(workspace.page, 'close-with-handoff-question')
    const reasons = dialog.getByRole('radiogroup', { name: /Motivo/ })
    await reasons
      .locator('label')
      .filter({ has: workspace.page.getByRole('radio', { name: 'Resuelto' }) })
      .click()
    const closed = workspace.page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/cases/${caseId}/close`) &&
        response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Cerrar caso' }).click()
    const response = await closed
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).toMatchObject({
      reason: 'resolved',
      handoffQuality: 'useful',
    })
    await expect(dialog).toBeHidden()
    // The customer sees the end; the case leaves Tomás's open cases.
    await expect(chat.status('ended')).toBeVisible()
    await expect(workspace.caseCard(natalia.name)).toHaveCount(0)
  })

  test("7 · turning AI off hands the assistant's conversation to people", async ({
    stack,
    actors,
    chatAs,
    availableAnalyst,
  }) => {
    const workspace = await availableAnalyst()
    const chat = await chatAs('cliente', natalia)
    await holdWithAssistant(chat, stack)
    await expect(chat.askPersonButton).toBeVisible()

    // Administración › Plataforma: "Funciones de IA" off.
    const admin = await actors.signedIn('administración', ACCOUNTS.admin)
    await admin.shell.rail.getByRole('link', { name: 'Plataforma' }).click()
    const toggle = admin.page.getByRole('switch', { name: 'Funciones de IA' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    // The customer sees the hand-over, live: the notice and then Tomás.
    await expect(chat.notice(chat.assistantCopy.handoverNotice)).toHaveCount(1, {
      timeout: 30_000,
    })
    await expect(chat.status({ agent: analystFirstName })).toBeVisible({ timeout: 30_000 })
    await expect(chat.askPersonButton).toHaveCount(0)

    // Tomás gets it with the "IA desactivada" banner.
    await expect(workspace.caseCard(natalia.name)).toBeVisible({ timeout: 30_000 })
    await workspace.openCase(natalia.name)
    await expect(
      workspace
        .messages(natalia.name)
        .filter({ hasText: 'IA desactivada: el caso pasó del asistente a una persona.' }),
    ).toHaveCount(1)
    await snap(workspace.page, 'analyst-ai-off-banner')
    await snap(chat.page, 'simulator-ai-off')

    // AI back on (the fixture also makes sure of it).
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await workspace.closeCase(natalia.name, 'Resuelto')
  })
})

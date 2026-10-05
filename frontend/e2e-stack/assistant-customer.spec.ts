import { LINKED } from './support/accounts'
import { expect, test } from './support/fixtures'
import {
  SCRIPTS,
  answeredByAssistant,
  converseUntil,
  looksPortuguese,
  snap,
} from './support/scenarios'

test.describe('The assistant in the customer simulator (stack)', () => {
  test('1 · a Spanish customer writes and the assistant answers in the simulator', async ({
    stack,
    chatAs,
  }) => {
    const chat = await chatAs('cliente', LINKED.natalia)
    // "escribiendo…" is watched from before the message leaves, so a quick answer is not missed.
    let typingShown = Promise.resolve(false)
    const state = await answeredByAssistant(chat, stack, () => {
      typingShown = chat.typing
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(() => true)
        .catch(() => false)
    })

    expect(await typingShown, '"El asistente virtual está escribiendo…" showed').toBe(true)
    // The assistant's bubble: bot mark and "Asistente virtual" above a pale blue bubble.
    const first = chat.assistantTurns.first()
    await expect(first).toBeVisible()
    await expect(first.locator('.bg-assistant-bubble')).toBeVisible()
    await expect(first.locator('svg.lucide-bot')).toBeVisible()
    await expect(chat.typing).toHaveCount(0)
    if (state.conversation?.status === 'with_assistant') {
      await expect(chat.headerLine(chat.assistantCopy.statusLine)).toBeVisible()
      await expect(chat.askPersonButton).toBeVisible()
    }
    await snap(chat.page, 'simulator-answer')
  })

  test('4 · the simulator asks to confirm and for the simulated second factor', async ({
    stack,
    chatAs,
  }) => {
    const chat = await chatAs('cliente', LINKED.natalia)
    // A dispute under the amount policy: "Confirma para seguir", then "Confirma que eres tú"
    // to file it. The model may ask for either, both or (rarely) neither: retried.
    const outcome = await converseUntil(
      chat,
      stack,
      SCRIPTS.smallDispute,
      ({ confirmations, stepUps }) => confirmations + stepUps > 0,
    )
    test.info().annotations.push({
      type: 'outcome',
      description: `confirmations=${outcome.confirmations} stepUps=${outcome.stepUps} status=${outcome.state.conversation?.status}`,
    })
    await expect(chat.confirmationCard).toHaveCount(0)
    await expect(chat.stepUpCard).toHaveCount(0)
    // Resolved by the assistant: the survey names it.
    if (outcome.state.conversation?.status === 'closed') {
      await expect(chat.page.getByRole('form', { name: chat.assistantCopy.survey })).toBeVisible()
    }
    await snap(chat.page, 'simulator-after-confirmation')
  })

  test('6 · a Portuguese customer is served by the assistant in Portuguese', async ({
    stack,
    chatAs,
  }) => {
    const chat = await chatAs('cliente', LINKED.rafael)
    const state = await answeredByAssistant(chat, stack)

    const turns = chat.assistantTurns
    await expect(turns.first()).toBeVisible()
    // The platform's words are Portuguese ("Assistente virtual"), and so are the model's.
    await expect(turns.first().getByText('Assistente virtual', { exact: true })).toBeVisible()
    const said = state.turns.filter((turn) => turn.authorRole === 'assistant')
    const text = said.map((turn) => turn.text).join(' ')
    expect(looksPortuguese(text), `the assistant wrote in Portuguese: "${text}"`).toBe(true)
    if (state.conversation?.status === 'with_assistant') {
      await expect(chat.headerLine(chat.assistantCopy.statusLine)).toBeVisible()
      await expect(chat.askPersonButton).toBeVisible()
    } else {
      // It handed Rafael to people at once: the hand-over is in Portuguese too.
      await expect(chat.notice(chat.assistantCopy.handoverNotice)).toBeVisible()
    }
    await snap(chat.page, 'simulator-portuguese')
  })
})

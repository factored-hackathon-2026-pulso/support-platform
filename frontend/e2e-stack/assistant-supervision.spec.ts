import { QueuesPage } from '../e2e/support/pages/supervision-pages'
import { ACCOUNTS, LINKED } from './support/accounts'
import { expect, test } from './support/fixtures'
import { holdWithAssistant, snap } from './support/scenarios'

const natalia = LINKED.natalia

test.describe('Supervisión and the assistant (stack)', () => {
  test('5 · Colas shows the assistant\'s case and "Tomar el caso" moves it to people', async ({
    stack,
    actors,
    chatAs,
  }) => {
    // Nobody is available: once taken from the assistant, the case waits in the queue.
    const chat = await chatAs('cliente', natalia)
    await holdWithAssistant(chat, stack)

    const supervisor = await actors.signedIn('supervisión', ACCOUNTS.supervisor)
    const queues = new QueuesPage(supervisor.page)
    await queues.goto('Español')
    const row = queues.caseRow('Español', natalia.name)
    await expect(row).toContainText('Con el asistente')
    await expect(row).toContainText('No corre')
    await expect(row).toContainText('Asistente virtual')
    await expect(row.locator('[data-status-shape="bot"]')).toBeVisible()
    // The language card counts the assistant's cases apart.
    await expect(supervisor.page.getByRole('button', { name: /Cola en español/ })).toContainText(
      /\d+ con el asistente/,
    )
    await snap(supervisor.page, 'colas-with-assistant')

    await row.getByRole('button', { name: `Tomar el caso de ${natalia.name}` }).click()
    await expect(supervisor.shell.toast('Tomaste el caso del asistente')).toBeVisible()
    await expect(
      supervisor.page.getByText(
        'Quedó en la cola en español: le llega a la primera persona disponible.',
      ),
    ).toBeVisible()
    await expect(row).not.toContainText('Con el asistente')
    await expect(row.getByRole('button', { name: /^Tomar el caso de / })).toHaveCount(0)
    await snap(supervisor.page, 'colas-after-taking')

    // The customer is told, live: the notice and "Te estamos pasando…"; no more "Hablar con una
    // persona".
    await expect(chat.notice(chat.assistantCopy.handoverNotice)).toHaveCount(1)
    await expect(chat.headerLine(chat.assistantCopy.handingOver)).toBeVisible()
    await expect(chat.askPersonButton).toHaveCount(0)
  })

  test('8 · Auditoría shows the assistant\'s events with the actor "Asistente virtual"', async ({
    stack,
    actors,
    chatAs,
  }) => {
    const chat = await chatAs('cliente', natalia)
    await holdWithAssistant(chat, stack)
    const open = await stack.openCase(natalia.id)
    expect(open?.status).toBeTruthy()
    const caseId = open?.caseId ?? ''

    const supervisor = await actors.signedIn('supervisión', ACCOUNTS.supervisor)
    await supervisor.page.goto(`/supervision/audit?case=${caseId}`)
    const log = supervisor.page.getByRole('table', { name: 'Eventos' })
    await expect(log).toBeVisible()
    // The assistant's own rows carry its badge and no person's name.
    const byAssistant = log.getByRole('row').filter({ hasText: 'Asistente virtual' })
    await expect(byAssistant.first()).toBeVisible()
    await expect(
      byAssistant.filter({ hasText: /El asistente respondió|Respondió al cliente \(asistente\)/ }),
    ).not.toHaveCount(0)
    await expect(
      log.getByRole('row').filter({ hasText: 'La conversación empezó con el asistente' }),
    ).not.toHaveCount(0)

    // Its detail.
    await byAssistant.first().click()
    const detail = supervisor.page.getByRole('complementary', { name: 'Detalle del registro' })
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('Asistente virtual')
    await snap(supervisor.page, 'audit-assistant')
  })
})

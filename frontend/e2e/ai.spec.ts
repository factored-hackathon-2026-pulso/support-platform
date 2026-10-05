import { CUSTOMERS, SEEDED, uniqueText } from './support/data'
import type { Locator } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { WorkspacePage } from './support/pages/workspace-page'

/**
 * The conversation header with the right panel open: the customer's name is not cut and no
 * header button covers the name or the case number (the panel leaves the conversation narrow).
 */
async function expectHeaderReadable(workspace: WorkspacePage, customerName: string) {
  const header = workspace.conversation(customerName).locator('header').first()
  const layout = await header.evaluate((el) => {
    const box = (node: Element) => node.getBoundingClientRect()
    const nameButton = el.querySelector('h2 button') ?? el.querySelector('h2')!
    const identity = [nameButton, ...el.querySelectorAll('p')].map(box)
    const actions = [...el.querySelectorAll('button')]
      .filter((button) => !button.closest('h2') && !button.closest('p'))
      .map(box)
    const overlaps = identity.some((a) =>
      actions.some(
        (b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
      ),
    )
    return {
      nameCut: nameButton.scrollWidth > nameButton.clientWidth + 1,
      overlaps,
      outside: actions.some((b) => b.right > box(el).right + 1),
    }
  })
  expect(layout).toEqual({ nameCut: false, overlaps: false, outside: false })
}

/**
 * The stage strip with the right panel open: the type name stays on one line and the stage line
 * is whole (it wraps instead of being cut with "…"), inside the conversation column.
 */
async function expectStripReadable(strip: Locator) {
  const layout = await strip.evaluate((el) => {
    const type = el.querySelector<HTMLElement>('[data-testid="stage-strip-type"]')!
    const line = el.querySelector<HTMLElement>('[data-testid="stage-strip-line"]')!
    const lineHeight = parseFloat(getComputedStyle(type).lineHeight)
    return {
      typeOnOneLine: type.getBoundingClientRect().height < lineHeight * 1.5,
      lineCut: line.scrollWidth > line.clientWidth + 1,
      outside: line.getBoundingClientRect().right > el.getBoundingClientRect().right + 1,
    }
  })
  expect(layout).toEqual({ typeOnOneLine: true, lineCut: false, outside: false })
}

test.describe('AI functions (slices 18 to 21)', () => {
  // The dev default is on: whatever happens, the next scenario starts with AI on.
  test.afterEach(async ({ api }) => {
    await api.setAiEnabled(true)
  })

  test('an admin turns AI off and on; the panel tabs and the case type follow the switch', async ({
    api,
    actors,
    people,
    customers,
  }) => {
    await api.setAiEnabled(true)
    const customer = CUSTOMERS.andres
    await customers.release(customer)
    const analyst = await people.analyst(['es'])

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()
    const chat = await actors.customer('cliente', customer)
    await chat.send(uniqueText('Me cobraron una cuota de manejo que no corresponde'))
    await workspace.openCase(customer.name)
    const panel = await workspace.openCustomerFile(customer.name)

    // AI on (slice 19): the ficha is the "Cliente" tab of "Apoyo del caso"; a case that did not
    // come from the assistant has no "Traspaso" tab.
    await expect(panel).toHaveAccessibleName('Apoyo del caso')
    await expect(panel.getByRole('tab', { name: 'Cliente' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(panel.getByRole('tab', { name: 'Traspaso' })).toHaveCount(0)
    // Slice 20: without agent-core the copilot answers `available: false`, so there is no
    // "Copiloto" or "Herramientas" tab and no draft; "Apoyo" in the header toggles the panel.
    await expect(panel.getByRole('tab', { name: 'Copiloto' })).toHaveCount(0)
    await expect(panel.getByRole('tab', { name: 'Herramientas' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Borrador del copiloto' })).toHaveCount(0)
    const support = workspace.conversation(customer.name).getByRole('button', { name: 'Apoyo' })
    await expect(support).toHaveAttribute('aria-expanded', 'true')
    // With the panel open the header still reads: the whole name, clear of the header's buttons.
    await expectHeaderReadable(workspace, customer.name)
    // It has "Tipo de caso" (every case opens without one).
    await expect(workspace.caseTypeMenu(panel)).toHaveAccessibleName(
      'Tipo de caso: Sin tipo. Cambiar el tipo de caso',
    )
    await expect(chat.page.locator('[data-ai-enabled="true"]')).toBeVisible()

    // Administración turns the AI functions off from "Plataforma".
    const admin = await actors.signedIn('administración', SEEDED.admin)
    await admin.shell.rail.getByRole('link', { name: 'Plataforma' }).click()
    const toggle = admin.page.getByRole('switch', { name: 'Funciones de IA' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(admin.page.getByText(SEEDED.admin.name, { exact: true })).toBeVisible()

    // Live, without a reload: the analyst's ficha is the people-only one again (no tabs), and
    // the simulator follows on its own socket.
    await expect(panel).toHaveAccessibleName('Ficha del cliente')
    await expect(panel.getByRole('tablist')).toHaveCount(0)
    await expect(support).toHaveCount(0)
    await expect(panel.getByText('Tipo de caso')).toHaveCount(0)
    await expect(
      panel.getByRole('button', { name: /^Prioridad: .*\. Cambiar la prioridad$/ }),
    ).toBeVisible()
    await expect(chat.page.locator('[data-ai-enabled="false"]')).toBeVisible()
    // A reload keeps it off (it is a persisted setting); the open ficha is in the URL.
    await page.reload()
    const reloaded = workspace.customerPanel()
    await expect(reloaded).toHaveAccessibleName('Ficha del cliente')
    await expect(reloaded.getByRole('region', { name: 'Este caso' })).toBeVisible()
    await expect(reloaded.getByText('Tipo de caso')).toHaveCount(0)

    // On again: the menu is back, live, and the analyst sets the type.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(reloaded).toHaveAccessibleName('Apoyo del caso')
    await expect(workspace.caseTypeMenu(reloaded)).toBeVisible()
    await expect(support).toBeVisible()
    await workspace.setCaseType(reloaded, 'Cobro indebido')
    await page.reload()
    await expect(workspace.caseTypeMenu(reloaded)).toHaveAccessibleName(
      'Tipo de caso: Cobro indebido. Cambiar el tipo de caso',
    )
  })

  test('the stage of the case type shows under the header and follows Supervisión live', async ({
    api,
    actors,
    people,
    customers,
  }) => {
    await api.setAiEnabled(true)
    const customer = CUSTOMERS.andres
    await customers.release(customer)
    const analyst = await people.analyst(['es'])

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()
    const chat = await actors.customer('cliente', customer)
    await chat.send(uniqueText('La app no me deja entrar desde ayer'))
    await workspace.openCase(customer.name)
    const conversation = workspace.conversation(customer.name)
    const panel = await workspace.openCustomerFile(customer.name)
    const strip = conversation.getByTestId('stage-strip')

    // "Sin tipo": no stage strip and no copilot.
    await expect(strip).toHaveCount(0)

    // A stage-3 type (seeded "Cobro indebido"): the strip says what the copilot does. Without
    // agent-core the copilot answers `available: false`, so no tab and no draft show (the draft
    // bar of a stage-3 type is covered by the component tests).
    await workspace.setCaseType(panel, 'Cobro indebido')
    await expect(strip).toContainText('Tipo de caso: Cobro indebido')
    await expect(strip).toContainText(
      'Etapa 3 de 3: el copiloto propone respuestas y deja herramientas listas',
    )
    await expect(page.getByRole('region', { name: 'Borrador del copiloto' })).toHaveCount(0)
    await expect(panel.getByRole('tab', { name: 'Copiloto' })).toHaveCount(0)
    // With the panel open (1440 px) the strip reads whole; the type with an agent has the
    // longest line ("Con agente: …").
    await expectStripReadable(strip)
    await workspace.setCaseType(panel, 'Cargo no reconocido')
    await expect(strip).toContainText('Con agente')
    await expectStripReadable(strip)

    // Another type: the strip follows; Supervisión moves it back and the strip follows live.
    await workspace.setCaseType(panel, 'Problema con app')
    const before = (await api.aiStages()).types.find((t) => t.caseType === 'app_issue')!.stage
    await expect(strip).toContainText(`Etapa ${before} de 3`)
    if (before > 0) {
      await api.moveStageBack('app_issue', before - 1)
      await expect(strip).toContainText(`Etapa ${before - 1} de 3`)
    }

    // Back to "Sin tipo": the strip goes away.
    await workspace.setCaseType(panel, 'Sin tipo')
    await expect(strip).toHaveCount(0)
  })
})

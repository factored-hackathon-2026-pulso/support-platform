import type { Page } from '@playwright/test'
import { SEEDED } from './support/data'
import { expect, test } from './support/fixtures'

/**
 * The screen's intro under the title is whole: it wraps, never cut with "…". Without agent-core
 * there is no "Constructor de agentes" button next to it, so the check narrows the window to
 * leave the intro less room than at 1440 px with the button.
 */
async function expectIntroWhole(page: Page, start: string) {
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: 1100, height: viewport.height })
  const intro = page.locator('header p', { hasText: start })
  await expect(intro).toBeVisible()
  const cut = await intro.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  await page.setViewportSize(viewport)
  expect(cut).toBe(false)
}

test.describe('Automatización (slice 22)', () => {
  // The dev default is on: whatever happens, the next scenario starts with AI on.
  test.afterEach(async ({ api }) => {
    await api.setAiEnabled(true)
  })

  test('Supervisión reads the case types, moves one back, and the rail item follows the AI switch', async ({
    api,
    actors,
  }) => {
    await api.setAiEnabled(true)
    // A type with a stage to give back and no agent (the seed has several; a rerun on the same
    // database may have moved one already).
    const stages = await api.aiStages()
    const candidate = stages.types.find(
      (t) => t.agent === 'none' && t.stage > 0 && t.caseType !== 'app_issue',
    )
    expect(candidate, 'a seeded type above stage 0 without an agent').toBeDefined()
    const type = candidate!
    const names: Record<string, string> = {
      branch_service: 'Atención en sucursal',
      service_quality: 'Calidad de servicio',
      virtual_card: 'Tarjeta virtual',
      undue_charge: 'Cobro indebido',
      unrecognized_charge: 'Cargo no reconocido',
    }
    const name = names[type.caseType]!

    const { page, shell } = await actors.signedIn('supervisión', SEEDED.supervisor)
    const item = shell.rail.getByRole('link', { name: /^Automatización/ })
    await item.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Automatización' })).toBeVisible()
    await expectIntroWhole(page, 'Cada tipo de caso madura')

    // The panorama from the seed: every type, the agent of "Cargo no reconocido".
    const table = page.getByRole('table', { name: 'Tipos de caso y su etapa' })
    await expect(table.getByRole('row')).toHaveCount(7)
    await expect(table.getByRole('row', { name: /Cargo no reconocido/ })).toContainText(
      'Con agente',
    )
    await expect(table.getByRole('row', { name: /Cargo no reconocido/ })).toContainText(
      'Lo atiende el agente Disputas',
    )

    // One type: how it matured and the team rule, then back one stage.
    await table.getByRole('button', { name: new RegExp(name) }).click()
    const panel = page.getByRole('complementary', { name: `Tipo de caso: ${name}` })
    await expect(panel.getByRole('heading', { name: 'Cómo maduró' })).toBeVisible()
    await expect(panel).toContainText('Regla del equipo (ejemplo)')
    await expect(panel).toContainText(`Etapa ${type.stage}`)
    await panel.getByRole('button', { name: 'Devolver a una etapa anterior' }).click()
    const dialog = page.getByRole('dialog', { name: `Devolver ${name} a una etapa anterior` })
    await expect(dialog.getByRole('radio').first()).toBeChecked()
    await dialog.getByRole('button', { name: 'Devolver' }).click()
    await expect(shell.toasts).toContainText(`${name} volvió a la etapa ${type.stage - 1}`)
    await expect(table.getByRole('row', { name: new RegExp(name) })).toContainText(
      `Etapa ${type.stage - 1}`,
    )

    // Without agent-core the builder's parts say so.
    await page
      .getByRole('navigation', { name: 'Secciones de Automatización' })
      .getByRole('link', { name: 'Propuestas' })
      .click()
    await expect(page.getByText('El motor de IA no está conectado')).toBeVisible()

    // Administración turns AI off: the item leaves the rail and the screen goes back to Colas;
    // on again, it is back. Live, without a reload.
    await api.setAiEnabled(false)
    await expect(item).toHaveCount(0)
    await expect(page).toHaveURL(/\/supervision\/queues$/)
    await api.setAiEnabled(true)
    await expect(item).toBeVisible()
  })

  test('in Portuguese, the case types table fits next to the type panel', async ({
    api,
    actors,
    people,
  }) => {
    await api.setAiEnabled(true)
    // A throwaway supervisor: the seeded accounts keep their language.
    const supervisor = await people.person(['supervisor'], ['es', 'pt'])
    const { page, shell } = await actors.signedIn('supervisão', supervisor)
    await shell.chooseLanguage('Português')
    await page.goto('/supervision/automation?type=undue_charge')
    await expect(page.getByRole('complementary', { name: /Cobrança indevida/ })).toBeVisible()
    await expectIntroWhole(page, 'Cada tipo de caso amadurece')
    const table = page.getByRole('table', { name: 'Tipos de caso e sua etapa' })
    await expect(table.getByRole('row')).toHaveCount(7)
    // Nothing of the table is cut by its card (the longer Portuguese labels made it overflow).
    const widths = await table.evaluate((el) => ({
      table: el.scrollWidth,
      card: el.parentElement!.clientWidth,
    }))
    expect(widths.table).toBeLessThanOrEqual(widths.card)
  })
})

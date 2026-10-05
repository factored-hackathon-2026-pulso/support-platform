import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AutomationApi from '@/features/automation/api'
import {
  askBuilder,
  fetchBuilderChat,
  fetchBuilderStatus,
  fetchProposals,
  moveStageBack,
  restartBuilderChat,
} from '@/features/automation/api'
import type * as CopilotApi from '@/features/copilot/api'
import { fetchAiStages } from '@/features/copilot/api'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview } from '@/features/supervision/api'
import { platformKeys } from '@/app/platform'
import { ApiProblem } from '@/lib/api'
import {
  BUILDER_OFF,
  BUILDER_ON,
  PROPOSAL_ID,
  builderMessage,
  makeSummary,
} from '@/test/automation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import { makeStages, makeTypeStage } from '@/test/stage-fixtures'
import { makeQueueOverview } from '@/test/supervision-fixtures'

vi.mock('@/features/automation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationApi>()
  return {
    ...actual,
    fetchBuilderStatus: vi.fn<typeof actual.fetchBuilderStatus>(),
    fetchProposals: vi.fn<typeof actual.fetchProposals>(),
    moveStageBack: vi.fn<typeof actual.moveStageBack>(),
    fetchBuilderChat: vi.fn<typeof actual.fetchBuilderChat>(),
    askBuilder: vi.fn<typeof actual.askBuilder>(),
    restartBuilderChat: vi.fn<typeof actual.restartBuilderChat>(),
  }
})

vi.mock('@/features/copilot/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CopilotApi>()
  return { ...actual, fetchAiStages: vi.fn<typeof actual.fetchAiStages>() }
})

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return { ...actual, fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>() }
})

/** The seed's story with the signals the canvas shows. */
function seededStages() {
  const stages = makeStages()
  return {
    ...stages,
    types: stages.types.map((entry) => {
      if (entry.caseType === 'undue_charge') {
        return {
          ...entry,
          reached: [
            { stage: 1, since: '2026-08-04T15:00:00Z' },
            { stage: 2, since: '2026-09-02T15:00:00Z' },
            { stage: 3, since: '2026-09-15T15:00:00Z' },
          ],
          agentSince: '2026-10-04T15:00:00Z',
          signals: {
            ...entry.signals,
            closedCases: 21,
            drafts: 100,
            draftsAsIs: 84,
            draftsEdited: 9,
            draftsDiscarded: 7,
          },
        }
      }
      if (entry.caseType === 'app_issue') {
        return {
          ...entry,
          signals: { ...entry.signals, closedCases: 12, toolCases: 10, toolUsedCases: 6 },
        }
      }
      return entry
    }),
  }
}

beforeEach(() => {
  vi.mocked(fetchAiStages).mockResolvedValue(seededStages())
  vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_OFF)
  vi.mocked(fetchProposals).mockResolvedValue({ items: [] })
  vi.mocked(fetchBuilderChat).mockResolvedValue({ available: true, messages: [] })
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

function renderAutomation(
  path = '/supervision/automation',
  options: { locale?: 'es' | 'pt-BR' } = {},
) {
  return renderRoute(path, { staff: supervisorStaff, aiEnabled: true, ...options })
}

const typesTable = () => screen.getByRole('table', { name: 'Tipos de caso y su etapa' })
const panel = (name: string) => screen.getByRole('complementary', { name: `Tipo de caso: ${name}` })

describe('/supervision/automation ("Automatización", slice 22)', () => {
  it('lists every case type with its stage, the signal it is measured by and the ready one on top', async () => {
    renderAutomation()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Automatización' }),
    ).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Tipos de caso y su etapa' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Cobro indebidoComisiones',
      'Cargo no reconocidoTransacciones',
      'Problema con appTécnico',
      'Atención en sucursalSucursal',
      'Calidad de servicioServicio',
      'Tarjeta virtualProducto nuevo (ejemplo)',
    ])
    const undue = rows[0]!
    expect(undue).toHaveTextContent('Etapa 3')
    expect(undue).toHaveTextContent(
      '84 de los últimos 100 borradores, tal cual o con cambios menores',
    )
    expect(undue).toHaveTextContent('Agente propuesto')
    expect(rows[1]).toHaveTextContent('Con agente')
    expect(rows[1]).toHaveTextContent('Lo atiende el agente Disputas')
    expect(rows[2]).toHaveTextContent('Herramientas usadas en 6 de 10 casos con propuestas')
    expect(screen.getByText('El sistema propone un agente para Cobro indebido')).toBeInTheDocument()
    expect(screen.getByText(/regla del equipo \(ejemplo\)/)).toBeInTheDocument()
    // The rail item, current and with news (a type is ready for an agent).
    expect(screen.getByRole('link', { name: 'Automatización, con novedades' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // The tabs of the section.
    const sections = screen.getByRole('navigation', { name: 'Secciones de Automatización' })
    expect(within(sections).getByRole('link', { name: 'Tipos de caso' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // No builder (agent-core not wired): no chat button.
    expect(screen.queryByRole('button', { name: 'Constructor de agentes' })).not.toBeInTheDocument()
  })

  it('opens a type: how it matured, the drafts, the team rule against today', async () => {
    const { user, router } = renderAutomation()
    await user.click(await screen.findByRole('button', { name: /Cobro indebido/ }))
    await waitFor(() => expect(router.state.location.search).toBe('?type=undue_charge'))
    const aside = panel('Cobro indebido')
    expect(within(aside).getByRole('heading', { name: 'Cómo maduró' })).toBeInTheDocument()
    expect(aside).toHaveTextContent('Desde el 4 ago 2026')
    expect(aside).toHaveTextContent('Propuesto el 4 oct 2026')
    expect(aside).toHaveTextContent('Borradores del copiloto, últimos 100')
    expect(aside).toHaveTextContent('84 tal cual o con cambios menores')
    expect(aside).toHaveTextContent('Etapa 3 a agente')
    expect(aside).toHaveTextContent(
      '80 % de los últimos 100 borradores se envían tal cual o con cambios menores',
    )
    expect(aside).toHaveTextContent('Regla del equipo (ejemplo)')
    // Without agent-core: no "Proponer un agente", it says why.
    expect(
      within(aside).queryByRole('button', { name: 'Proponer un agente' }),
    ).not.toBeInTheDocument()
    expect(aside).toHaveTextContent('El motor de IA no está conectado')
    await user.click(within(aside).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it("shows the current step of a type below stage 3 with today's value", async () => {
    renderAutomation('/supervision/automation?type=app_issue')
    const aside = await screen.findByRole('complementary', {
      name: 'Tipo de caso: Problema con app',
    })
    expect(aside).toHaveTextContent('Hoy: 6 de 10 casos')
    expect(aside).toHaveTextContent(
      'El sistema propone un agente cuando el tipo completa las tres etapas con la regla del equipo.',
    )
    expect(aside).not.toHaveTextContent('Borradores del copiloto')
  })

  it('moves a type back: the stages are read again and a toast says it', async () => {
    vi.mocked(moveStageBack).mockResolvedValue({
      changed: true,
      type: makeTypeStage('app_issue', 1),
    })
    const { user } = renderAutomation('/supervision/automation?type=app_issue')
    const aside = await screen.findByRole('complementary', {
      name: 'Tipo de caso: Problema con app',
    })
    await user.click(within(aside).getByRole('button', { name: 'Devolver a una etapa anterior' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Devolver Problema con app a una etapa anterior',
    })
    expect(
      within(dialog).getByRole('radio', { name: 'Etapa 1: el copiloto responde' }),
    ).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'Etapa 0: solo personas' }))
    vi.mocked(fetchAiStages).mockClear()
    await user.click(within(dialog).getByRole('button', { name: 'Devolver' }))
    expect(moveStageBack).toHaveBeenCalledWith('app_issue', 0)
    expect(await screen.findByText('Problema con app volvió a la etapa 0')).toBeInTheDocument()
    await waitFor(() => expect(fetchAiStages).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says why moving back failed, and never offers it while an agent serves the type', async () => {
    vi.mocked(moveStageBack).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'invalid_transition', title: 'x' }),
    )
    const { user } = renderAutomation('/supervision/automation?type=undue_charge')
    const aside = await screen.findByRole('complementary', { name: 'Tipo de caso: Cobro indebido' })
    await user.click(within(aside).getByRole('button', { name: 'Devolver a una etapa anterior' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('radio', { name: 'Etapa 3: retirar la propuesta de agente' }),
    ).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Devolver' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'El tipo de caso cambió mientras lo mirabas.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await user.click(screen.getByRole('button', { name: /Cargo no reconocido/ }))
    const served = await screen.findByRole('complementary', {
      name: 'Tipo de caso: Cargo no reconocido',
    })
    expect(
      within(served).queryByRole('button', { name: 'Devolver a una etapa anterior' }),
    ).not.toBeInTheDocument()
    expect(served).toHaveTextContent('Un agente atiende este tipo')
    expect(served).toHaveTextContent('Lo atiende el agente Disputas')
  })

  it('follows the stages live (ai.stage_updated)', async () => {
    const { sockets } = renderAutomation()
    await screen.findByRole('table', { name: 'Tipos de caso y su etapa' })
    act(() => sockets.last()?.open())
    vi.mocked(fetchAiStages).mockResolvedValue({
      ...seededStages(),
      types: seededStages().types.map((entry) =>
        entry.caseType === 'app_issue' ? makeTypeStage('app_issue', 3) : entry,
      ),
    })
    act(() =>
      sockets.last()?.receive({
        type: 'ai.stage_updated',
        id: 'EVT-stage-1',
        occurredAt: '2026-10-05T15:00:00Z',
        data: {
          entity: 'case_type',
          entityId: 'app_issue',
          caseId: null,
          actor: { role: 'supervisor', id: null },
          payload: { caseType: 'app_issue' },
        },
      }),
    )
    await waitFor(() =>
      expect(within(typesTable()).getByRole('row', { name: /Problema con app/ })).toHaveTextContent(
        'Etapa 3',
      ),
    )
  })

  it('proposes an agent through the builder chat, and links the proposal it made', async () => {
    vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_ON)
    // An older thread: "Proponer un agente" starts a new conversation instead of continuing it.
    vi.mocked(fetchBuilderChat).mockResolvedValue({
      available: true,
      messages: [
        builderMessage('m0', 'person', '¿Qué agentes puedo modificar?'),
        builderMessage('m00', 'agent', 'Cuéntame qué cambio quieres en ese agente.', 'm0'),
      ],
    })
    vi.mocked(restartBuilderChat).mockResolvedValue({ available: true, messages: [] })
    vi.mocked(askBuilder).mockResolvedValue({
      message: builderMessage('m1', 'person', 'x'),
      answers: [builderMessage('m2', 'agent', `Creé la propuesta ${PROPOSAL_ID}.`, 'm1')],
      proposals: [makeSummary()],
      replayed: false,
    })
    const { user } = renderAutomation('/supervision/automation?type=undue_charge')
    const aside = await screen.findByRole('complementary', { name: 'Tipo de caso: Cobro indebido' })
    await user.click(await within(aside).findByRole('button', { name: 'Proponer un agente' }))
    const sheet = await screen.findByRole('dialog', { name: 'Constructor de agentes' })
    expect(
      await within(sheet).findByText('Cuéntale qué agente quieres o qué cambiar en uno.'),
    ).toBeInTheDocument()
    expect(restartBuilderChat).toHaveBeenCalledTimes(1)
    expect(within(sheet).queryByText('¿Qué agentes puedo modificar?')).not.toBeInTheDocument()
    const box = within(sheet).getByRole('textbox', { name: 'Mensaje para el constructor' })
    expect(box).toHaveValue(
      'Agente: cobros. Objetivo: un agente nuevo que atienda los chats de los casos de tipo ' +
        '"Cobro indebido" como lo hace el equipo y pase a una persona lo que no pueda resolver. ' +
        'El equipo envía 84 de los últimos 100 borradores del copiloto tal cual o con cambios menores.',
    )
    await user.click(within(sheet).getByRole('button', { name: 'Enviar' }))
    expect(askBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Agente: cobros.') }),
    )
    // The restart went first: the message opens the new thread.
    expect(vi.mocked(restartBuilderChat).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(askBuilder).mock.invocationCallOrder[0]!,
    )
    expect(await within(sheet).findByText(`Creé la propuesta ${PROPOSAL_ID}.`)).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Abrir propuesta' })).toHaveAttribute(
      'href',
      `/supervision/automation/proposals/${PROPOSAL_ID}?type=undue_charge`,
    )
    expect(box).toHaveValue('')
  })

  it('retries the new conversation before sending when the restart failed on opening', async () => {
    vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_ON)
    vi.mocked(restartBuilderChat)
      .mockRejectedValueOnce(ApiProblem.network())
      .mockResolvedValueOnce({ available: true, messages: [] })
    vi.mocked(askBuilder).mockResolvedValue({
      message: builderMessage('m1', 'person', 'x'),
      answers: [builderMessage('m2', 'agent', '¿Qué herramientas usa el equipo?', 'm1')],
      proposals: [],
      replayed: false,
    })
    const { user } = renderAutomation('/supervision/automation?type=undue_charge')
    const aside = await screen.findByRole('complementary', { name: 'Tipo de caso: Cobro indebido' })
    await user.click(await within(aside).findByRole('button', { name: 'Proponer un agente' }))
    const sheet = await screen.findByRole('dialog', { name: 'Constructor de agentes' })
    expect(
      await within(sheet).findByText('No pudimos empezar una conversación nueva'),
    ).toBeInTheDocument()
    expect(askBuilder).not.toHaveBeenCalled()
    await user.click(within(sheet).getByRole('button', { name: 'Enviar' }))
    expect(await within(sheet).findByText('¿Qué herramientas usa el equipo?')).toBeInTheDocument()
    expect(restartBuilderChat).toHaveBeenCalledTimes(2)
    expect(vi.mocked(restartBuilderChat).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(askBuilder).mock.invocationCallOrder[0]!,
    )
  })

  it('keeps a failed message for a retry with the same id, and starts a new conversation', async () => {
    vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_ON)
    vi.mocked(fetchBuilderChat).mockResolvedValue({
      available: true,
      messages: [
        builderMessage('m0', 'person', 'Hola'),
        builderMessage('m00', 'agent', 'Te paso con un asesor.', 'm0'),
      ],
    })
    vi.mocked(askBuilder).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(restartBuilderChat).mockResolvedValue({ available: true, messages: [] })
    const { user } = renderAutomation()
    await user.click(await screen.findByRole('button', { name: 'Constructor de agentes' }))
    const sheet = await screen.findByRole('dialog', { name: 'Constructor de agentes' })
    expect(await within(sheet).findByText('Te paso con un asesor.')).toBeInTheDocument()
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Mensaje para el constructor' }),
      'Un agente',
    )
    await user.click(within(sheet).getByRole('button', { name: 'Enviar' }))
    expect(await within(sheet).findByText(/El constructor no respondió/)).toBeInTheDocument()
    const first = vi.mocked(askBuilder).mock.calls[0]?.[0]
    vi.mocked(askBuilder).mockResolvedValue({
      message: builderMessage('m1', 'person', 'Un agente'),
      answers: [builderMessage('m2', 'agent', '¿Para qué tipo de caso?', 'm1')],
      proposals: [],
      replayed: false,
    })
    await user.click(within(sheet).getByRole('button', { name: 'Reintentar' }))
    expect(vi.mocked(askBuilder).mock.calls[1]?.[0]).toEqual(first)
    expect(await within(sheet).findByText('¿Para qué tipo de caso?')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Nueva conversación' }))
    expect(restartBuilderChat).toHaveBeenCalled()
    await waitFor(() =>
      expect(within(sheet).queryByText('Te paso con un asesor.')).not.toBeInTheDocument(),
    )
    expect(
      within(sheet).getByText('Cuéntale qué agente quieres o qué cambiar en uno.'),
    ).toBeInTheDocument()
  })

  it('does not exist with AI off: no rail item, and its link goes back to Colas', async () => {
    const { router, queryClient } = renderRoute('/supervision/automation', {
      staff: supervisorStaff,
      aiEnabled: false,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/supervision/queues'))
    expect(screen.queryByRole('link', { name: /Automatización/ })).not.toBeInTheDocument()
    act(() => queryClient.setQueryData(platformKeys.settings(), { aiEnabled: true }))
    expect(await screen.findByRole('link', { name: /Automatización/ })).toBeInTheDocument()
  })

  it('leaves when AI is turned off while she is on it', async () => {
    const { router, queryClient } = renderAutomation()
    await screen.findByRole('table', { name: 'Tipos de caso y su etapa' })
    act(() => queryClient.setQueryData(platformKeys.settings(), { aiEnabled: false }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/supervision/queues'))
  })

  it('speaks Portuguese', async () => {
    renderAutomation('/supervision/automation?type=undue_charge', { locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Automação' })).toBeInTheDocument()
    expect(
      await screen.findByRole('table', { name: 'Tipos de caso e sua etapa' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('O sistema propõe um agente para Cobrança indevida'),
    ).toBeInTheDocument()
    const aside = screen.getByRole('complementary', { name: 'Tipo de caso: Cobrança indevida' })
    expect(aside).toHaveTextContent('Como amadureceu')
    expect(aside).toHaveTextContent('Regra da equipe (exemplo)')
    expect(screen.getByRole('link', { name: 'Automação, com novidades' })).toBeInTheDocument()
  })
})

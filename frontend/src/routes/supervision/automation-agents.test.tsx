import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AutomationApi from '@/features/automation/api'
import {
  fetchAgentVersions,
  fetchAlias,
  fetchBuilderStatus,
  fetchProposals,
  fetchRelease,
  promoteAlias,
  trackProposal,
} from '@/features/automation/api'
import type * as CopilotApi from '@/features/copilot/api'
import { fetchAiStages } from '@/features/copilot/api'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview } from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import {
  BASE_RELEASE_ID,
  BUILDER_OFF,
  BUILDER_ON,
  RELEASE_ID,
  makeAlias,
  makeRelease,
  makeSummary,
} from '@/test/automation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import { makeStages } from '@/test/stage-fixtures'
import { makeQueueOverview } from '@/test/supervision-fixtures'

vi.mock('@/features/automation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationApi>()
  return {
    ...actual,
    fetchBuilderStatus: vi.fn<typeof actual.fetchBuilderStatus>(),
    fetchProposals: vi.fn<typeof actual.fetchProposals>(),
    fetchAlias: vi.fn<typeof actual.fetchAlias>(),
    fetchRelease: vi.fn<typeof actual.fetchRelease>(),
    fetchAgentVersions: vi.fn<typeof actual.fetchAgentVersions>(),
    promoteAlias: vi.fn<typeof actual.promoteAlias>(),
    trackProposal: vi.fn<typeof actual.trackProposal>(),
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

const notFound = () => new ApiProblem({ status: 404, code: 'registry_not_found', title: 'x' })

beforeEach(() => {
  vi.mocked(fetchAiStages).mockResolvedValue(makeStages())
  vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_ON)
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchProposals).mockResolvedValue({
    items: [
      makeSummary({ state: 'published', source: 'chat' }),
      makeSummary({
        proposalId: 'p-engine',
        agentId: 'disputas',
        title: 'Pasar a una persona si roban la tarjeta',
        source: 'engine',
        live: false,
      }),
      makeSummary({
        proposalId: 'p-registry',
        agentId: 'sucursales',
        title: 'Atender los chats de Atención en sucursal',
        source: 'registry',
        registeredBy: null,
        createdBy: 'constructor-bot',
      }),
    ],
    registryListed: true,
  })
  vi.mocked(fetchAlias).mockImplementation((agentId, alias) => {
    if (agentId === 'disputas') {
      return Promise.resolve(
        makeAlias({ alias, releaseId: alias === 'staging' ? RELEASE_ID : BASE_RELEASE_ID }),
      )
    }
    if (alias === 'staging') {
      return Promise.resolve(makeAlias({ agentId, alias, releaseId: 'rel-cobros' }))
    }
    return Promise.reject(notFound())
  })
  vi.mocked(fetchRelease).mockImplementation((releaseId) =>
    Promise.resolve(
      releaseId === BASE_RELEASE_ID
        ? makeRelease({ baseReleaseId: 'rel-older' })
        : makeRelease({
            releaseId,
            entities: [
              {
                ref: { kind: 'agent', id: 'disputas', version: '2.1.0' },
                contentHash: 'x',
                docs: { description: 'd', rationale: '', changelog: '' },
                changedVsBase: true,
              },
            ],
          }),
    ),
  )
  vi.mocked(fetchAgentVersions).mockResolvedValue({
    items: [
      {
        ref: { kind: 'agent', id: 'disputas', version: '1.0.0' },
        contentHash: 'a',
        docs: { description: 'Importado desde YAML', rationale: 'semilla', changelog: '' },
        createdBy: 'root',
        createdAt: '2026-09-02T15:00:00Z',
      },
      {
        ref: { kind: 'agent', id: 'disputas', version: '2.1.0' },
        contentHash: 'b',
        docs: {
          description: 'Atiende cargos no reconocidos',
          rationale: '',
          changelog: 'Pasa a una persona si el cliente cuenta que le robaron la tarjeta',
        },
        createdBy: 'STF-1',
        createdAt: '2026-09-28T15:00:00Z',
      },
    ],
  })
})

function render(path: string, locale: 'es' | 'pt-BR' = 'es') {
  return renderRoute(path, { staff: supervisorStaff, aiEnabled: true, locale })
}

describe('agents (slice 22)', () => {
  it('lists the agents serving a type and the ones proposals are for, with where they run', async () => {
    render('/supervision/automation/agents')
    const table = await screen.findByRole('table', { name: 'Agentes' })
    const disputas = await within(table).findByRole('row', { name: /Disputas/ })
    expect(disputas).toHaveTextContent('Cargo no reconocido')
    expect(await within(disputas).findByText('En producción')).toBeInTheDocument()
    expect(await within(disputas).findByText('1.0.0')).toBeInTheDocument()
    const cobros = within(table).getByRole('row', { name: /Cobros/ })
    expect(cobros).toHaveTextContent('Ningún tipo de caso')
    expect(await within(cobros).findByText('Solo en pruebas')).toBeInTheDocument()
  })

  it('waits for the registry before saying where an agent runs (never "Sin datos del registro" meanwhile)', async () => {
    const answers: Array<() => void> = []
    vi.mocked(fetchAlias).mockImplementation(
      (agentId, alias) =>
        new Promise((resolve) => {
          answers.push(() =>
            resolve(
              makeAlias({
                agentId,
                alias,
                releaseId: alias === 'staging' ? RELEASE_ID : BASE_RELEASE_ID,
              }),
            ),
          )
        }),
    )
    render('/supervision/automation/agents')
    const table = await screen.findByRole('table', { name: 'Agentes' })
    const disputas = await within(table).findByRole('row', { name: /Disputas/ })
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0))
    expect(within(disputas).queryByText('Sin datos del registro')).not.toBeInTheDocument()
    expect(within(disputas).queryByText('En producción')).not.toBeInTheDocument()

    for (const answer of answers) answer()
    expect(await within(disputas).findByText('En producción')).toBeInTheDocument()
    expect(within(disputas).queryByText('Sin datos del registro')).not.toBeInTheDocument()
  })

  it('shows one agent: where it runs, what it serves, its versions; rolls prod back with her code', async () => {
    vi.mocked(promoteAlias).mockResolvedValue({})
    const { user } = render('/supervision/automation/agents/disputas')
    expect(await screen.findByRole('heading', { level: 1, name: 'Disputas' })).toBeInTheDocument()
    expect(await screen.findByText('Versión 1.0.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cargo no reconocido' })).toHaveAttribute(
      'href',
      '/supervision/automation?type=unrecognized_charge',
    )
    const versions = await screen.findByText(
      'Pasa a una persona si el cliente cuenta que le robaron la tarjeta',
    )
    expect(versions).toBeInTheDocument()
    expect(screen.getByText('Pasar a una persona si roban la tarjeta')).toBeInTheDocument()
    // There is nothing in the registry that pauses an agent: no such button.
    expect(screen.queryByRole('button', { name: /Pausar/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Volver a la versión anterior' }))
    const dialog = screen.getByRole('dialog', { name: 'Volver a la versión anterior de Disputas' })
    await user.click(within(dialog).getByRole('textbox', { name: 'Dígito 1' }))
    await user.keyboard('000000')
    await user.click(within(dialog).getByRole('button', { name: 'Volver a la versión anterior' }))
    expect(promoteAlias).toHaveBeenCalledWith('disputas', 'prod', {
      releaseId: 'rel-older',
      reason: '',
      stepUpCode: '000000',
    })
    expect(await screen.findByText('Producción volvió a la versión anterior')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pasar a producción' })).toBeInTheDocument()
  })

  it('without agent-core shows the types it serves and says the engine is missing', async () => {
    vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_OFF)
    render('/supervision/automation/agents')
    expect(await screen.findByText('El motor de IA no está conectado')).toBeInTheDocument()
    const row = await screen.findByRole('row', { name: /Disputas/ })
    expect(row).toHaveTextContent('Sin datos del registro')
    expect(fetchAlias).not.toHaveBeenCalled()
  })
})

describe('proposals (slice 22)', () => {
  it('lists every proposal with its state and origin, the improvement engine included', async () => {
    render('/supervision/automation/proposals')
    const table = await screen.findByRole('table', { name: 'Propuestas para cambiar agentes' })
    const engine = within(table).getByRole('row', { name: /roban la tarjeta/ })
    expect(engine).toHaveTextContent('Del motor de mejora')
    expect(engine).toHaveTextContent('Sin confirmar')
    expect(within(table).getByRole('row', { name: /Cobro indebido/ })).toHaveTextContent(
      'Del constructor',
    )
    // only agent-core's list has it (the builder chat made it without naming it)
    expect(within(table).getByRole('row', { name: /Atención en sucursal/ })).toHaveTextContent(
      'Del registro',
    )
    // the list is whole: no notice, no "Seguir"
    expect(
      screen.queryByText('Solo ves las propuestas que la plataforma conoce'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Seguir' })).not.toBeInTheDocument()
  })

  it("without agent-core's list says so and tracks a proposal by id", async () => {
    vi.mocked(fetchProposals).mockResolvedValue({
      items: [makeSummary({ live: false })],
      registryListed: false,
    })
    vi.mocked(trackProposal).mockRejectedValueOnce(notFound())
    vi.mocked(trackProposal).mockResolvedValueOnce(makeSummary())
    const { user } = render('/supervision/automation/proposals')
    expect(
      await screen.findByText('Solo ves las propuestas que la plataforma conoce'),
    ).toBeInTheDocument()
    const field = await screen.findByRole('textbox', { name: 'Id de la propuesta' })
    await user.type(field, 'nope')
    await user.click(screen.getByRole('button', { name: 'Seguir' }))
    expect(
      await screen.findByText('El registro no tiene una propuesta con ese id.'),
    ).toBeInTheDocument()
    await user.type(field, '-1')
    await user.click(screen.getByRole('button', { name: 'Seguir' }))
    expect(trackProposal).toHaveBeenLastCalledWith('nope-1')
    expect(await screen.findByText('La propuesta ya está en la lista')).toBeInTheDocument()
  })

  it('speaks Portuguese', async () => {
    render('/supervision/automation/proposals', 'pt-BR')
    const table = await screen.findByRole('table', { name: 'Propostas para mudar agentes' })
    expect(within(table).getByRole('row', { name: /roban la tarjeta/ })).toHaveTextContent(
      'Do motor de melhoria',
    )
    expect(within(table).getByRole('row', { name: /Atención en sucursal/ })).toHaveTextContent(
      'Do registro',
    )
  })
})

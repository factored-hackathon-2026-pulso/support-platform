import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AutomationApi from '@/features/automation/api'
import {
  activateTypeAgent,
  approveProposal,
  evaluateProposal,
  fetchAlias,
  fetchBuilderStatus,
  fetchProposal,
  fetchProposals,
  fetchRelease,
  freezeProposal,
  publishProposal,
  rejectProposal,
  validateProposal,
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
  PROPOSAL_ID,
  RELEASE_ID,
  makeAlias,
  makeEvalReport,
  makeProposalDetail,
  makeRelease,
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
    fetchProposal: vi.fn<typeof actual.fetchProposal>(),
    validateProposal: vi.fn<typeof actual.validateProposal>(),
    freezeProposal: vi.fn<typeof actual.freezeProposal>(),
    evaluateProposal: vi.fn<typeof actual.evaluateProposal>(),
    approveProposal: vi.fn<typeof actual.approveProposal>(),
    rejectProposal: vi.fn<typeof actual.rejectProposal>(),
    publishProposal: vi.fn<typeof actual.publishProposal>(),
    fetchAlias: vi.fn<typeof actual.fetchAlias>(),
    fetchRelease: vi.fn<typeof actual.fetchRelease>(),
    activateTypeAgent: vi.fn<typeof actual.activateTypeAgent>(),
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

const PATH = `/supervision/automation/proposals/${PROPOSAL_ID}`

beforeEach(() => {
  vi.mocked(fetchAiStages).mockResolvedValue(makeStages())
  vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_ON)
  vi.mocked(fetchProposals).mockResolvedValue({ items: [], registryListed: true })
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchRelease).mockImplementation((releaseId) =>
    Promise.resolve(
      releaseId === RELEASE_ID
        ? makeRelease({ releaseId: RELEASE_ID, agentId: 'cobros', proposalId: PROPOSAL_ID })
        : makeRelease(),
    ),
  )
})

function renderProposal(path = `${PATH}?type=undue_charge`, locale: 'es' | 'pt-BR' = 'es') {
  return renderRoute(path, { staff: supervisorStaff, aiEnabled: true, locale })
}

function problem(status: number, code: string, extensions: Record<string, unknown> = {}) {
  return new ApiProblem({ status, code, title: 'x', extensions })
}

async function typeCode(
  user: ReturnType<typeof renderProposal>['user'],
  dialog: HTMLElement,
  code: string,
) {
  await user.click(within(dialog).getByRole('textbox', { name: 'Dígito 1' }))
  await user.keyboard(code)
}

describe('a proposal (slice 22)', () => {
  it('shows what the draft changes and where it is, then validates and prepares it', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(makeProposalDetail())
    vi.mocked(validateProposal).mockResolvedValueOnce({
      violations: [
        { rule: 'G0-05', flow: null, nodeId: null, path: 'id', message: 'Falta el flujo' },
      ],
      candidateHash: null,
      autoBumped: [],
    })
    vi.mocked(freezeProposal).mockResolvedValue({
      proposalId: PROPOSAL_ID,
      candidateHash: 'h1',
      releaseIdPreview: RELEASE_ID,
      newVersions: [],
      autoBumped: [],
    })
    const { user } = renderProposal()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Agente para Cobro indebido' }),
    ).toBeInTheDocument()
    const path = screen.getByRole('navigation', { name: 'Ruta' })
    expect(within(path).getByRole('link', { name: 'Cobro indebido' })).toHaveAttribute(
      'href',
      '/supervision/automation?type=undue_charge',
    )
    const steps = screen.getByRole('list', { name: 'Avance de la propuesta' })
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Borrador', 'Lista para probar', 'Probada', 'Aprobada', 'Publicada', 'Activa'])
    expect(within(steps).getByText('Borrador').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )
    expect(screen.getByText('Agente Cobros')).toBeInTheDocument()
    expect(screen.getByText('Para Cobro indebido')).toBeInTheDocument()
    // What it changes: the agent's tools and languages, then each entity with its docs.
    expect(screen.getByText('Leer movimientos')).toBeInTheDocument()
    expect(screen.getByText('Atiende los cobros indebidos')).toBeInTheDocument()
    expect(screen.getByText('t/resumen')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Validar' }))
    expect(await screen.findByText('Lo que hay que corregir')).toBeInTheDocument()
    expect(screen.getByText('Falta el flujo')).toBeInTheDocument()
    vi.mocked(validateProposal).mockResolvedValueOnce({
      violations: [],
      candidateHash: 'h1',
      autoBumped: [],
    })
    await user.click(screen.getByRole('button', { name: 'Validar' }))
    expect(
      await screen.findByText('El borrador es válido: se puede preparar para la prueba.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preparar para la prueba' }))
    expect(freezeProposal).toHaveBeenCalledWith(PROPOSAL_ID)
  })

  it('says an agent without an evaluation suite cannot be tested, without calling', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({
        state: 'candidate',
        candidateHash: 'h1',
        baseReleaseId: BASE_RELEASE_ID,
      }),
    )
    renderProposal()
    expect(await screen.findByText('Este agente no tiene suite de evaluación')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Probar' })).not.toBeInTheDocument()
    expect(evaluateProposal).not.toHaveBeenCalled()
  })

  it('tests with the suite and shows a failed gate as a result', async () => {
    const detail = makeProposalDetail({ state: 'candidate', candidateHash: 'h1' })
    detail.changes.push({
      kind: 'eval_suite',
      content: { id: 'suite-cobros', version: '1.0.0' },
      docs: { description: 'Escenarios', rationale: '', changelog: '' },
    })
    vi.mocked(fetchProposal).mockResolvedValue(detail)
    vi.mocked(evaluateProposal).mockRejectedValue(
      problem(409, 'registry_gate_failed', { report: makeEvalReport({ verdict: 'fail' }) }),
    )
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Probar' }))
    expect(evaluateProposal).toHaveBeenCalledWith(PROPOSAL_ID, {
      suiteId: 'suite-cobros',
      suiteVersion: '1.0.0',
    })
    expect(await screen.findByText('No pasó la prueba')).toBeInTheDocument()
    expect(
      screen.getByText(
        'La propuesta volvió a borrador. Revisa cada criterio antes de pedir otro cambio.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('traspaso_a_tiempo')).toBeInTheDocument()
    expect(screen.getByText('1 de 2 criterios')).toBeInTheDocument()
  })

  it('treats a 404 on the test as no suite', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({
        state: 'candidate',
        candidateHash: 'h1',
        baseReleaseId: BASE_RELEASE_ID,
      }),
    )
    vi.mocked(fetchRelease).mockResolvedValue(
      makeRelease({ evalSuiteRefs: [{ kind: 'eval_suite', id: 'suite-x', version: '1.0.0' }] }),
    )
    vi.mocked(evaluateProposal).mockRejectedValue(problem(404, 'registry_not_found'))
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Probar' }))
    expect(await screen.findByText('Este agente no tiene suite de evaluación')).toBeInTheDocument()
  })

  it('approves with her code: a wrong one says the attempts left', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail(
        { state: 'evaluated', candidateHash: 'h1' },
        {
          lastEval: {
            evalRunId: 'ev-1',
            proposalId: PROPOSAL_ID,
            candidateHash: 'h1',
            baseReleaseId: null,
            suite: { kind: 'eval_suite', id: 'suite-cobros', version: '1.0.0' },
            verdict: 'pass',
            report: makeEvalReport(),
            at: '2026-10-05T14:00:00Z',
          },
        },
      ),
    )
    vi.mocked(approveProposal).mockRejectedValueOnce(
      problem(422, 'builder_step_up_invalid', { remainingAttempts: 4 }),
    )
    vi.mocked(approveProposal).mockResolvedValueOnce({})
    const { user } = renderProposal()
    expect(await screen.findByText('Pasó la prueba')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aprobar' }))
    const dialog = screen.getByRole('dialog', { name: 'Aprobar' })
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(within(dialog).getByText('Escribe los 6 dígitos.')).toBeInTheDocument()
    await typeCode(user, dialog, '111111')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(
      await within(dialog).findByText('El código no es correcto. Te quedan 4 intentos.'),
    ).toBeInTheDocument()
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(approveProposal).toHaveBeenLastCalledWith(PROPOSAL_ID, {
      candidateHash: 'h1',
      acceptYardstickLoosened: false,
      stepUpCode: '000000',
    })
    expect(await screen.findByText('Aprobaste la propuesta')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks to accept a looser yardstick before approving', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'evaluated', candidateHash: 'h1' }),
    )
    vi.mocked(approveProposal).mockRejectedValueOnce(
      problem(409, 'registry_loosening_not_accepted', {
        yardstickLoosened: [
          { kind: 'floor_loosened', target: 'resuelve', message: 'Baja el mínimo de 0.85 a 0.80' },
        ],
      }),
    )
    vi.mocked(approveProposal).mockResolvedValueOnce({})
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Aprobar' }))
    const dialog = screen.getByRole('dialog', { name: 'Aprobar' })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(await within(dialog).findByText('Baja el mínimo de 0.85 a 0.80')).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Acepto que la prueba sea menos exigente' }),
    )
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(approveProposal).toHaveBeenLastCalledWith(
      PROPOSAL_ID,
      expect.objectContaining({ acceptYardstickLoosened: true }),
    )
  })

  it('rejects with a reason and her code', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'evaluated', candidateHash: 'h1' }),
    )
    vi.mocked(rejectProposal).mockResolvedValue(makeProposalDetail().proposal)
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Rechazar' }))
    const dialog = screen.getByRole('dialog', { name: 'Rechazar' })
    await user.type(within(dialog).getByRole('textbox', { name: /Motivo/ }), 'Falta el traspaso')
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Rechazar' }))
    expect(rejectProposal).toHaveBeenCalledWith(PROPOSAL_ID, {
      reason: 'Falta el traspaso',
      stepUpCode: '000000',
    })
  })

  it('publishes with her code and one key per publication', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'approved', candidateHash: 'h1' }),
    )
    vi.mocked(publishProposal).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(publishProposal).mockResolvedValueOnce(makeRelease({ releaseId: RELEASE_ID }))
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Publicar' }))
    const dialog = screen.getByRole('dialog', { name: 'Publicar' })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }))
    expect(await within(dialog).findByText(/El motor de IA no respondió/)).toBeInTheDocument()
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }))
    const [first, second] = vi.mocked(publishProposal).mock.calls
    expect(first?.[1].idempotencyKey).toMatch(/^publish-/)
    expect(second?.[1].idempotencyKey).toBe(first?.[1].idempotencyKey)
    expect(await screen.findByText('Publicada: queda lista para activar')).toBeInTheDocument()
  })

  it('activates the published agent for the type with her code, then says it serves it', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'published', candidateHash: 'h1' }),
    )
    vi.mocked(fetchAlias).mockResolvedValue(
      makeAlias({ agentId: 'cobros', alias: 'staging', releaseId: RELEASE_ID }),
    )
    const active = { ...makeTypeStage('undue_charge', 3, 'active'), agentId: 'cobros' }
    vi.mocked(activateTypeAgent).mockImplementation(() => {
      vi.mocked(fetchAiStages).mockResolvedValue({
        ...makeStages(),
        types: makeStages().types.map((t) => (t.caseType === 'undue_charge' ? active : t)),
      })
      return Promise.resolve({ changed: true, type: active, alias: null })
    })
    const { user } = renderProposal()
    expect(
      await screen.findByRole('heading', { name: 'Activar el agente Cobros' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(RELEASE_ID)).toBeInTheDocument()
    const activate = screen.getByRole('button', { name: 'Activar agente' })
    expect(activate).toHaveAttribute('aria-disabled', 'true')
    await user.click(activate)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Revisé el resultado de la prueba' }))
    await user.click(activate)
    const dialog = screen.getByRole('dialog', { name: 'Activar el agente Cobros' })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Activar agente' }))
    expect(activateTypeAgent).toHaveBeenCalledWith('undue_charge', {
      agentId: 'cobros',
      releaseId: RELEASE_ID,
      stepUpCode: '000000',
    })
    expect(
      await screen.findByRole('heading', { name: 'El agente Cobros ya atiende Cobro indebido' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver el agente' })).toHaveAttribute(
      'href',
      '/supervision/automation/agents/cobros',
    )
    const steps = screen.getByRole('list', { name: 'Avance de la propuesta' })
    await waitFor(() => expect(within(steps).getAllByText('Hecho')).toHaveLength(6))
  })

  it('asks for the type when the link names none, among the ready ones', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'published', candidateHash: 'h1' }),
    )
    vi.mocked(fetchAlias).mockResolvedValue(
      makeAlias({ agentId: 'cobros', alias: 'staging', releaseId: RELEASE_ID }),
    )
    const { user, router } = renderProposal(PATH)
    const select = await screen.findByRole('combobox', { name: 'Tipo de caso que atenderá' })
    await user.selectOptions(select, 'undue_charge')
    await waitFor(() => expect(router.state.location.search).toBe('?type=undue_charge'))
  })

  it('without agent-core says so', async () => {
    vi.mocked(fetchBuilderStatus).mockResolvedValue(BUILDER_OFF)
    vi.mocked(fetchProposal).mockRejectedValue(problem(404, 'assistant_disabled'))
    renderProposal()
    expect(await screen.findByText('El motor de IA no está conectado')).toBeInTheDocument()
  })

  it('speaks Portuguese', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'evaluated', candidateHash: 'h1' }),
    )
    const { user } = renderProposal(`${PATH}?type=undue_charge`, 'pt-BR')
    expect(await screen.findByRole('list', { name: 'Andamento da proposta' })).toBeInTheDocument()
    expect(screen.getByText('Para Cobrança indevida')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(screen.getByRole('dialog', { name: 'Aprovar' })).toHaveTextContent('Confirme que é você')
  })
})

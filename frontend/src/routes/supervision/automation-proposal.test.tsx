import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AutomationApi from '@/features/automation/api'
import {
  activateTypeAgent,
  approveAndPublishProposal,
  evaluateProposal,
  fetchAlias,
  fetchBuilderStatus,
  fetchProposal,
  fetchProposalRecord,
  fetchProposals,
  fetchRelease,
  freezeProposal,
  promoteAlias,
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
  EVIDENCE_CASE_ID,
  GONE_CASE_ID,
  PROPOSAL_ID,
  RELEASE_ID,
  makeAlias,
  makeEvalReport,
  makeHistoryEntry,
  makeImprovement,
  makeProposalDetail,
  makeRecord,
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
    fetchProposalRecord: vi.fn<typeof actual.fetchProposalRecord>(),
    promoteAlias: vi.fn<typeof actual.promoteAlias>(),
    validateProposal: vi.fn<typeof actual.validateProposal>(),
    freezeProposal: vi.fn<typeof actual.freezeProposal>(),
    evaluateProposal: vi.fn<typeof actual.evaluateProposal>(),
    approveAndPublishProposal: vi.fn<typeof actual.approveAndPublishProposal>(),
    rejectProposal: vi.fn<typeof actual.rejectProposal>(),
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
  vi.mocked(fetchProposalRecord).mockResolvedValue(makeRecord())
  // By default the agent runs nowhere yet (its first activation).
  vi.mocked(fetchAlias).mockRejectedValue(problem(404, 'registry_not_found'))
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
    const steps = await screen.findByRole('list', { name: 'Avance del agente' })
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Revisar', 'Probar', 'Aprobar', 'Activar'])
    expect(within(steps).getByText('Revisar').closest('li')).toHaveAttribute('aria-current', 'step')
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
        'El agente volvió a borrador. Revisa cada criterio antes de pedir otro cambio.',
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
    vi.mocked(approveAndPublishProposal).mockRejectedValueOnce(
      problem(422, 'builder_step_up_invalid', { remainingAttempts: 4 }),
    )
    vi.mocked(approveAndPublishProposal).mockResolvedValueOnce(
      makeRelease({ releaseId: RELEASE_ID }),
    )
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
    expect(approveAndPublishProposal).toHaveBeenLastCalledWith(PROPOSAL_ID, {
      candidateHash: 'h1',
      acceptYardstickLoosened: false,
      stepUpCode: '000000',
      idempotencyKey: expect.stringMatching(/^publish-/) as string,
    })
    // one decision: the single "Aprobar", with one code per attempt, never a separate "Publicar"
    expect(approveAndPublishProposal).toHaveBeenCalledTimes(2)
    expect(
      await screen.findByText('Aprobado: el agente queda listo para activar'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows each release value and the donor release of an inherited one', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail(
        { state: 'evaluated', candidateHash: 'h1' },
        {
          review: {
            functionalChanges: [],
            releaseChanges: [
              {
                field: 'max_input_chars',
                before: null,
                after: 4000,
                inherited: true,
                inheritedFrom: 'rel-donor',
              },
              {
                field: 'language_detection',
                before: 'off',
                after: 'on',
                inherited: false,
                inheritedFrom: null,
              },
            ],
            suite: { kind: 'eval_suite', id: 'suite-cobros', version: '1.0.0' },
            suiteChanges: [],
            gate: [],
            yardstickLoosened: [],
          },
        },
      ),
    )
    renderProposal()
    const section = await screen.findByRole('region', { name: 'Valores de la release' })
    const items = within(section).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('max_input_chars')).toBeInTheDocument()
    expect(within(items[0]!).getByText('heredado de rel-donor')).toBeInTheDocument()
    expect(within(items[0]!).getByText(/sin valor/)).toBeInTheDocument()
    expect(within(items[1]!).getByText('language_detection')).toBeInTheDocument()
    expect(within(items[1]!).queryByText(/heredado de/)).not.toBeInTheDocument()
  })

  it('asks to accept a looser yardstick before approving', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'evaluated', candidateHash: 'h1' }),
    )
    vi.mocked(approveAndPublishProposal).mockRejectedValueOnce(
      problem(409, 'registry_loosening_not_accepted', {
        yardstickLoosened: [
          { kind: 'floor_loosened', target: 'resuelve', message: 'Baja el mínimo de 0.85 a 0.80' },
        ],
      }),
    )
    vi.mocked(approveAndPublishProposal).mockResolvedValueOnce(
      makeRelease({ releaseId: RELEASE_ID }),
    )
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
    expect(approveAndPublishProposal).toHaveBeenLastCalledWith(
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
    const reasons = within(dialog).getByRole('combobox', { name: /Motivo/ })
    expect(
      within(reasons)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Elige un motivo',
      'Falta evidencia',
      'Cambia el elemento equivocado',
      'Demasiado riesgo',
      'Repite otra propuesta',
      'Choca con una política',
      'Hay que mejorar la redacción',
      'Otro motivo',
    ])
    await user.type(within(dialog).getByRole('textbox', { name: /Detalle/ }), 'Falta el traspaso')
    await typeCode(user, dialog, '000000')
    // the reason is required before the code is sent
    expect(within(dialog).getByRole('button', { name: 'Rechazar' })).toBeDisabled()
    await user.selectOptions(reasons, 'wording')
    await user.click(within(dialog).getByRole('button', { name: 'Rechazar' }))
    expect(rejectProposal).toHaveBeenCalledWith(PROPOSAL_ID, {
      reason: 'Falta el traspaso',
      reasonCode: 'wording',
      stepUpCode: '000000',
    })
  })

  it('retries an approval whose publication failed with the same key and no second "Publicar"', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'evaluated', candidateHash: 'h1' }),
    )
    vi.mocked(approveAndPublishProposal).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(approveAndPublishProposal).mockResolvedValueOnce(
      makeRelease({ releaseId: RELEASE_ID }),
    )
    const { user } = renderProposal()
    await user.click(await screen.findByRole('button', { name: 'Aprobar' }))
    const dialog = screen.getByRole('dialog', { name: 'Aprobar' })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(await within(dialog).findByText(/El motor de IA no respondió/)).toBeInTheDocument()
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    const [first, second] = vi.mocked(approveAndPublishProposal).mock.calls
    expect(first?.[1].idempotencyKey).toMatch(/^publish-/)
    expect(second?.[1].idempotencyKey).toBe(first?.[1].idempotencyKey)
    expect(
      await screen.findByText('Aprobado: el agente queda listo para activar'),
    ).toBeInTheDocument()
  })

  it('offers "Reintentar" for a proposal approved whose publication did not happen', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'approved', candidateHash: 'h1' }),
    )
    vi.mocked(approveAndPublishProposal).mockResolvedValueOnce(
      makeRelease({ releaseId: RELEASE_ID }),
    )
    const { user } = renderProposal()
    expect(await screen.findByText(/Quedó aprobado, pero no se pudo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    const dialog = screen.getByRole('dialog', { name: 'Aprobar' })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }))
    expect(approveAndPublishProposal).toHaveBeenCalledTimes(1)
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
    const steps = screen.getByRole('list', { name: 'Avance del agente' })
    await waitFor(() => expect(within(steps).getAllByText('Hecho')).toHaveLength(4))
  })

  it('asks for the type when the link names none, among the ready ones', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({ state: 'published', candidateHash: 'h1' }),
    )
    vi.mocked(fetchAlias).mockImplementation((agentId, alias) =>
      alias === 'staging'
        ? Promise.resolve(makeAlias({ agentId, alias, releaseId: RELEASE_ID }))
        : Promise.reject(problem(404, 'registry_not_found')),
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
    const steps = await screen.findByRole('list', { name: 'Andamento do agente' })
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(
      ['Revisar', 'Testar', 'Aprovar', 'Ativar'].map((label, i) =>
        i < 2 ? `${label}Feito` : label,
      ),
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Agente para Cobrança indevida' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Para Cobrança indevida')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(screen.getByRole('dialog', { name: 'Aprovar' })).toHaveTextContent('Confirme que é você')
  })
})

describe("an improvement engine's proposal (P6: dossier and decisions)", () => {
  const ENGINE_PATH = PATH
  const engineHistory = [
    makeHistoryEntry('tracked', { source: 'engine', actorId: null, actorName: null }),
  ]

  function engineProposal(proposal: Parameters<typeof makeProposalDetail>[0] = {}) {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail({
        agentId: 'disputas',
        origin: 'auto_detect',
        baseReleaseId: BASE_RELEASE_ID,
        title: '[improvement-engine] disputas confirmar-cargo',
        ...proposal,
      }),
    )
  }

  it('shows the dossier as plain text with its evidence cases as case links', async () => {
    engineProposal()
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({ improvement: makeImprovement(), history: engineHistory }),
    )
    renderProposal(ENGINE_PATH)
    const dossier = await screen.findByRole('region', { name: 'Informe del motor de mejora' })
    expect(
      within(dossier).getByText('Disputas: confirmar el cargo antes de pedir el comprobante'),
    ).toBeInTheDocument()
    const problemText = within(dossier).getByText(/Los clientes con un cargo no reconocido/)
    expect(problemText.textContent).toBe(
      'Los clientes con un cargo no reconocido escalan más por chat.\nEl paso de confirmación falta.',
    )
    expect(problemText).toHaveClass('whitespace-pre-line')
    expect(within(dossier).getByText('Efecto esperado')).toBeInTheDocument()
    expect(within(dossier).getByText(/Celda: 96 de 240/)).toBeInTheDocument()
    // Spanish UI: no note about the dossier's language
    expect(
      within(dossier).queryByText('El motor de mejora escribe este informe en español.'),
    ).not.toBeInTheDocument()
    const cases = within(dossier).getByRole('list', { name: 'Casos de evidencia del informe' })
    expect(
      within(cases).getByRole('link', { name: `Abrir el caso ${EVIDENCE_CASE_ID}` }),
    ).toHaveAttribute('href', `/supervision/cases/${EVIDENCE_CASE_ID}`)
    expect(within(cases).getByText('Cargo no reconocido')).toBeInTheDocument()
    expect(within(cases).getByText('Cerrado')).toBeInTheDocument()
    // a case the platform no longer has: listed, without a link
    expect(within(cases).getByText(GONE_CASE_ID)).toBeInTheDocument()
    expect(within(cases).queryByRole('link', { name: new RegExp(GONE_CASE_ID) })).toBeNull()
    expect(within(cases).getByText('Ya no está en la plataforma')).toBeInTheDocument()
    // the history starts with the engine's announcement
    const history = screen.getByRole('region', { name: 'Historial' })
    expect(within(history).getByText('El motor de mejora la anunció')).toBeInTheDocument()
  })

  it('says when the engine attached no cases', async () => {
    engineProposal()
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({ improvement: makeImprovement({ evidenceCases: [] }), history: engineHistory }),
    )
    renderProposal(ENGINE_PATH)
    expect(
      await screen.findByText('El motor no adjuntó casos: la evidencia es agregada.'),
    ).toBeInTheDocument()
  })

  it('in Portuguese, says the engine writes the dossier in Spanish', async () => {
    engineProposal()
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({ improvement: makeImprovement(), history: engineHistory }),
    )
    renderProposal(ENGINE_PATH, 'pt-BR')
    const dossier = await screen.findByRole('region', { name: 'Relatório do motor de melhoria' })
    expect(
      within(dossier).getByText('O motor de melhoria escreve este relatório em espanhol.'),
    ).toBeInTheDocument()
    expect(within(dossier).getByText('Efeito esperado')).toBeInTheDocument()
    expect(within(dossier).getByText(/Los clientes con un cargo/)).toHaveAttribute('lang', 'es')
    expect(within(dossier).getByText('Não está mais na plataforma')).toBeInTheDocument()
  })

  it('shows no dossier for a proposal the engine did not announce', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(makeProposalDetail())
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({ history: [makeHistoryEntry('created')] }),
    )
    renderProposal()
    expect(await screen.findByText('Lucía Gómez creó la propuesta')).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Informe del motor de mejora' }),
    ).not.toBeInTheDocument()
  })

  it('says so when the engine announced it but its dossier is gone', async () => {
    engineProposal()
    vi.mocked(fetchProposalRecord).mockResolvedValue(makeRecord({ history: engineHistory }))
    renderProposal(ENGINE_PATH)
    expect(
      await screen.findByText(
        'El motor de mejora anunció esta propuesta, pero ya no encontramos su informe en la plataforma.',
      ),
    ).toBeInTheDocument()
  })

  it('tells the verdict story: tests, a rejection with its reason, approval and production', async () => {
    engineProposal({ state: 'published', candidateHash: 'h1' })
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({
        history: [
          ...engineHistory,
          makeHistoryEntry('evaluated', { verdict: 'fail', items: 3, itemsFailed: 1 }),
          makeHistoryEntry('rejected', { reasonCode: 'insufficient_evidence' }),
          makeHistoryEntry('evaluated', { verdict: 'pass', items: 3, itemsFailed: 0 }),
          makeHistoryEntry('approved'),
          makeHistoryEntry('published', { releaseId: RELEASE_ID }),
          makeHistoryEntry('promoted', { alias: 'prod', releaseId: RELEASE_ID }),
        ],
      }),
    )
    vi.mocked(fetchAlias).mockImplementation((agentId, alias) =>
      Promise.resolve(makeAlias({ agentId, alias, releaseId: RELEASE_ID })),
    )
    renderProposal(ENGINE_PATH)
    const history = await screen.findByRole('region', { name: 'Historial' })
    const steps = within(history)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(steps).toHaveLength(7)
    expect(steps[1]).toContain('No pasó la prueba y volvió a borrador')
    expect(steps[1]).toContain('2 de 3 criterios')
    expect(steps[2]).toContain('Lucía Gómez la rechazó')
    expect(steps[2]).toContain('Falta evidencia')
    expect(steps[5]).toContain(`Versión ${RELEASE_ID}`)
    expect(steps[6]).toContain('Lucía Gómez la pasó a producción')
    // prod holds this proposal's release: the last step is done
    expect(
      await screen.findByRole('heading', {
        name: 'La versión de esta propuesta ya está en producción',
      }),
    ).toBeInTheDocument()
    const stepper = screen.getByRole('list', { name: 'Avance del agente' })
    expect(within(stepper).getByText('En producción')).toBeInTheDocument()
    expect(within(stepper).getAllByText('Hecho')).toHaveLength(4)
  })

  it('compares the current version with the proposal, criterion by criterion', async () => {
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail(
        { state: 'evaluated', candidateHash: 'h1', agentId: 'disputas' },
        {
          lastEval: {
            evalRunId: 'ev-1',
            proposalId: PROPOSAL_ID,
            candidateHash: 'h1',
            baseReleaseId: BASE_RELEASE_ID,
            suite: { kind: 'eval_suite', id: 'suite-disputas', version: '1.0.0' },
            verdict: 'pass',
            report: makeEvalReport({
              items: makeEvalReport().items.map((item) => ({ ...item, passed: true })),
            }),
            at: '2026-10-05T14:00:00Z',
          },
        },
      ),
    )
    renderProposal(ENGINE_PATH)
    const table = await screen.findByRole('table', { name: 'Resultado de la prueba' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Criterio', 'Versión actual', 'Esta propuesta', 'Mínimo', 'Resultado'])
    const row = within(table).getByRole('row', { name: /resuelve_sin_persona/ })
    expect(within(row).getByText('0.90')).toBeInTheDocument()
    expect(within(row).getByText('0.92')).toBeInTheDocument()
    expect(within(row).getByText('0.85')).toBeInTheDocument()
    expect(
      screen.getByText('La prueba la deja lista para aprobar: cumple todos los criterios.'),
    ).toBeInTheDocument()
  })

  it('a draft rejected before says why', async () => {
    engineProposal()
    vi.mocked(fetchProposal).mockResolvedValue(
      makeProposalDetail(
        { agentId: 'disputas' },
        {
          lastDecision: {
            decision: 'rejected',
            reasonCode: 'policy_conflict',
            decidedAt: '2026-10-05T13:00:00Z',
          },
        },
      ),
    )
    renderProposal(ENGINE_PATH)
    expect(await screen.findByText('La última vez se rechazó')).toBeInTheDocument()
    expect(screen.getByText('Choca con una política')).toBeInTheDocument()
  })

  it('passes a new version of an agent in production to production with her code', async () => {
    engineProposal({ state: 'published', candidateHash: 'h1' })
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({
        history: [...engineHistory, makeHistoryEntry('published', { releaseId: RELEASE_ID })],
      }),
    )
    vi.mocked(fetchAlias).mockImplementation((agentId, alias) =>
      Promise.resolve(
        makeAlias({
          agentId,
          alias,
          releaseId: alias === 'prod' ? BASE_RELEASE_ID : RELEASE_ID,
        }),
      ),
    )
    vi.mocked(promoteAlias).mockImplementation(() => {
      vi.mocked(fetchAlias).mockImplementation((agentId, alias) =>
        Promise.resolve(makeAlias({ agentId, alias, releaseId: RELEASE_ID })),
      )
      return Promise.resolve({})
    })
    const { user } = renderProposal(ENGINE_PATH)
    const panel = await screen.findByRole('region', { name: 'Pasar a producción' })
    expect(screen.queryByRole('button', { name: 'Activar agente' })).not.toBeInTheDocument()
    expect(within(panel).getByText(BASE_RELEASE_ID)).toBeInTheDocument()
    expect(within(panel).getByText(RELEASE_ID)).toBeInTheDocument()
    const stepper = screen.getByRole('list', { name: 'Avance del agente' })
    expect(within(stepper).getByText('En producción')).toBeInTheDocument()
    const submit = within(panel).getByRole('button', { name: 'Pasar a producción' })
    await user.click(submit)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(
      within(panel).getByRole('checkbox', { name: 'Revisé el resultado de la prueba' }),
    )
    await user.click(submit)
    const dialog = screen.getByRole('dialog', {
      name: 'Pasar a producción la versión de esta propuesta',
    })
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Pasar a producción' }))
    expect(promoteAlias).toHaveBeenCalledWith('disputas', 'prod', {
      releaseId: RELEASE_ID,
      reason: '',
      stepUpCode: '000000',
    })
    expect(
      await screen.findByRole('heading', {
        name: 'La versión de esta propuesta ya está en producción',
      }),
    ).toBeInTheDocument()
  })

  it('speaks Portuguese on the way to production', async () => {
    engineProposal({ state: 'published', candidateHash: 'h1' })
    vi.mocked(fetchProposalRecord).mockResolvedValue(
      makeRecord({
        history: [...engineHistory, makeHistoryEntry('published', { releaseId: RELEASE_ID })],
      }),
    )
    vi.mocked(fetchAlias).mockImplementation((agentId, alias) =>
      Promise.resolve(makeAlias({ agentId, alias, releaseId: BASE_RELEASE_ID })),
    )
    renderProposal(ENGINE_PATH, 'pt-BR')
    const panel = await screen.findByRole('region', { name: 'Passar para produção' })
    expect(within(panel).getByRole('button', { name: 'Passar para produção' })).toBeInTheDocument()
    expect(screen.getByText('Em produção')).toBeInTheDocument()
    expect(screen.getByText('O motor de melhoria a anunciou')).toBeInTheDocument()
  })
})

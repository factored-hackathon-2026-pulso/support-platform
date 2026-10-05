import type { Page, Route } from '@playwright/test'
import { SEEDED } from './support/data'
import { expect, test } from './support/fixtures'

/**
 * The improvement engine's proposal page (P6): its dossier, the evidence cases as links to the
 * supervisor's read-only case view, the test report base against candidate, the history of the
 * decisions and "Pasar a producción".
 *
 * The e2e backend runs without agent-core, so the builder routes answer 404 there and the engine
 * cannot announce (the announce route asks the registry first). The browser answers the
 * `/builder/*` calls with a synthetic engine proposal (`page.route`); everything else is the real
 * platform: the session, the shell, the AI switch, and the case the evidence link opens (a seeded
 * case). The backend side of the record (`GET /builder/proposals/{id}/record`) is covered by
 * `backend/tests/api/test_proposal_record_api.py`.
 */

const PROPOSAL_ID = '0199b7e2-5f1a-7c3d-9e4b-engine000001'
const AGENT = 'disputas'
const PROD_RELEASE = 'rel-2a99d62f9ffa101c'
const NEW_RELEASE = 'rel-5d1f0a9c3b2e4f6a'
/** Seeded case 101 (Cargo no reconocido): a real case of the e2e database. */
const EVIDENCE_CASE = 'CASE-00000000000000000000000101'
/** An id the engine sent that names no case here. */
const GONE_CASE = 'CASE-0000000000000000000000ZZZZ'
const AT = '2026-10-05T14:00:00Z'

const PROPOSAL = {
  proposalId: PROPOSAL_ID,
  agentId: AGENT,
  origin: 'auto_detect',
  state: 'published',
  rev: 3,
  baseReleaseId: PROD_RELEASE,
  title: '[improvement-engine] disputas confirmar-cargo',
  createdBy: 'engine',
  candidateHash: 'ab'.repeat(32),
  updatedAt: AT,
}

const REPORT = {
  verdict: 'pass',
  items: [
    {
      metricId: 'resuelve_sin_persona',
      phase: 'new_yardstick',
      role: 'gate',
      value: '0.92',
      baseValue: '0.84',
      noiseMargin: '0.02',
      floor: '0.85',
      passed: true,
      reason: 'Sobre el mínimo',
    },
    {
      metricId: 'traspaso_a_tiempo',
      phase: 'platform',
      role: 'guardrail',
      value: '0.97',
      baseValue: '0.96',
      noiseMargin: null,
      floor: '0.95',
      passed: true,
      reason: 'Sobre el mínimo',
    },
  ],
  yardstickChanges: [],
  detail: null,
  runs: null,
  results: [],
  judgeNotes: [],
}

const DETAIL = {
  proposal: PROPOSAL,
  changes: [
    {
      kind: 'prompt',
      content: { id: 'p/confirmar_cargo', version: '1.0.1' },
      docs: {
        description:
          'DECISIÓN: proponer a supervisión.\nProblema observado: falta confirmar el cargo.',
        rationale: 'Hipótesis de intervención sobre una asociación.',
        changelog: 'Solo propuesta.',
      },
    },
  ],
  lastEval: {
    evalRunId: 'ev-1',
    proposalId: PROPOSAL_ID,
    candidateHash: 'ab'.repeat(32),
    baseReleaseId: PROD_RELEASE,
    suite: { kind: 'eval_suite', id: 'suite-disputas', version: '1.0.0' },
    verdict: 'pass',
    report: REPORT,
    at: AT,
  },
  review: null,
  lastDecision: { decision: 'approved', reasonCode: null, decidedAt: AT },
}

const RECORD = {
  improvement: {
    title: 'Disputas: confirmar el cargo antes de pedir el comprobante',
    problem:
      'Los clientes con un cargo no reconocido escalan más por chat.\nFalta el paso de confirmación.',
    evidence: 'Celda: 96 de 240 casos escalados frente a 48 de 240 en la base del mismo canal.',
    expectedEffect: 'Menos escalaciones en esta celda. Es una hipótesis, no una predicción.',
    language: 'es',
    announcedAt: AT,
    evidenceCases: [
      {
        caseId: EVIDENCE_CASE,
        available: true,
        status: 'assigned',
        caseType: 'unrecognized_charge',
        channel: 'chat_web',
        language: 'es',
        openedAt: AT,
      },
      {
        caseId: GONE_CASE,
        available: false,
        status: null,
        caseType: null,
        channel: null,
        language: null,
        openedAt: null,
      },
    ],
  },
  history: [
    entry('tracked', { source: 'engine', actorId: null, actorName: null }),
    entry('evaluated', { verdict: 'fail', items: 2, itemsFailed: 1, suiteId: 'suite-disputas' }),
    entry('rejected', { reasonCode: 'wording' }),
    entry('evaluated', { verdict: 'pass', items: 2, itemsFailed: 0, suiteId: 'suite-disputas' }),
    entry('approved'),
    entry('published', { releaseId: NEW_RELEASE }),
  ],
}

function entry(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    kind,
    at: AT,
    actorId: 'STF-00000000000000000000000005',
    actorName: SEEDED.supervisor.name,
    source: null,
    verdict: null,
    items: null,
    itemsFailed: null,
    suiteId: null,
    reasonCode: null,
    releaseId: null,
    alias: null,
    ...overrides,
  }
}

function release(releaseId: string) {
  return {
    releaseId,
    status: 'active',
    agentId: AGENT,
    entities: [
      {
        ref: { kind: 'agent', id: AGENT, version: '1.0.0' },
        contentHash: 'abc',
        docs: { description: 'Disputas', rationale: '', changelog: '' },
        changedVsBase: false,
      },
    ],
    knowledgeSnapshot: null,
    proposalId: releaseId === NEW_RELEASE ? PROPOSAL_ID : null,
    baseReleaseId: null,
    publishedBy: 'root',
    publishedAt: AT,
    evalSuiteRefs: [{ kind: 'eval_suite', id: 'suite-disputas', version: '1.0.0' }],
    interrupts: [],
    languageDetection: { id: 'lang-es-pt', version: '1.0.0' },
    injectionRuleset: null,
    maxInputChars: 4000,
  }
}

/**
 * Answer the builder's calls as agent-core and the platform would for an engine proposal of an
 * agent in production. `promoted` flips once "Pasar a producción" was confirmed.
 */
async function serveEngineProposal(page: Page): Promise<{ promotions: unknown[] }> {
  const state = { promoted: false, promotions: [] as unknown[] }
  await page.route(/\/api\/v1\/builder\//, async (route: Route) => {
    const request = route.request()
    const origin = request.headers()['origin'] ?? '*'
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const path = new URL(request.url()).pathname.replace('/api/v1/builder', '')
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', json: body })
    if (path === '/status') {
      return reply({
        available: true,
        canApprove: true,
        canRevoke: false,
        stepUpMethod: 'authenticator',
        stepUpDigits: 6,
      })
    }
    if (path === '/proposals') {
      return reply({ items: [], registryListed: true })
    }
    if (path === `/proposals/${PROPOSAL_ID}`) return reply(DETAIL)
    if (path === `/proposals/${PROPOSAL_ID}/record`) {
      const history = state.promoted
        ? [...RECORD.history, entry('promoted', { alias: 'prod', releaseId: NEW_RELEASE })]
        : RECORD.history
      return reply({ ...RECORD, history })
    }
    if (path === `/aliases/${AGENT}/prod`) {
      return reply({
        agentId: AGENT,
        alias: 'prod',
        releaseId: state.promoted ? NEW_RELEASE : PROD_RELEASE,
        status: 'active',
      })
    }
    if (path === `/aliases/${AGENT}/staging`) {
      return reply({ agentId: AGENT, alias: 'staging', releaseId: NEW_RELEASE, status: 'active' })
    }
    if (path === `/aliases/${AGENT}/prod/promote` && request.method() === 'POST') {
      state.promotions.push(request.postDataJSON())
      state.promoted = true
      return reply({
        agentId: AGENT,
        alias: 'prod',
        before: PROD_RELEASE,
        after: NEW_RELEASE,
        actor: 'STF-00000000000000000000000005',
        reason: '',
        at: AT,
      })
    }
    const releaseMatch = /^\/releases\/([^/]+)$/.exec(path)
    if (releaseMatch?.[1]) return reply(release(decodeURIComponent(releaseMatch[1])))
    if (path === '/chat') return reply({ available: true, messages: [], awaiting: null })
    return reply({ type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' }, 404)
  })
  return state
}

test.describe("An improvement engine's proposal (P6)", () => {
  test.afterEach(async ({ api }) => {
    await api.setAiEnabled(true)
  })

  test('Supervisión reads the dossier, opens an evidence case and passes the new version to production', async ({
    api,
    actors,
  }) => {
    await api.setAiEnabled(true)
    const { page } = await actors.signedIn('supervisión', SEEDED.supervisor)
    const served = await serveEngineProposal(page)

    await page.goto(`/supervision/automation/proposals/${PROPOSAL_ID}`)
    await expect(page.getByRole('heading', { level: 1, name: PROPOSAL.title })).toBeVisible()

    // The dossier: plain text, the three sections, the cases.
    const dossier = page.getByRole('region', { name: 'Informe del motor de mejora' })
    await expect(dossier).toContainText(RECORD.improvement.title)
    await expect(dossier.getByText('Problema', { exact: true })).toBeVisible()
    await expect(dossier.getByText('Evidencia', { exact: true })).toBeVisible()
    await expect(dossier.getByText('Efecto esperado', { exact: true })).toBeVisible()
    await expect(dossier).toContainText('Falta el paso de confirmación.')
    const cases = dossier.getByRole('list', { name: 'Casos de evidencia del informe' })
    await expect(cases.getByRole('listitem')).toHaveCount(2)
    await expect(cases.getByRole('listitem').nth(1)).toContainText('Ya no está en la plataforma')
    await expect(cases.getByRole('link')).toHaveCount(1)

    // The test, base against candidate, and the verdict story.
    const report = page.getByRole('table', { name: 'Resultado de la prueba' })
    await expect(report.getByRole('row', { name: /resuelve_sin_persona/ })).toContainText('0.84')
    await expect(report.getByRole('row', { name: /resuelve_sin_persona/ })).toContainText('0.92')
    const history = page.getByRole('region', { name: 'Historial' })
    await expect(history.getByRole('listitem')).toHaveCount(6)
    await expect(history).toContainText('El motor de mejora la anunció')
    await expect(history).toContainText(`${SEEDED.supervisor.name} la rechazó`)
    await expect(history).toContainText('Hay que mejorar la redacción')

    // An agent in production: "Pasar a producción", never "Activar".
    const steps = page.getByRole('list', { name: 'Avance de la propuesta' })
    await expect(steps).toContainText('En producción')
    await expect(page.getByRole('button', { name: 'Activar agente' })).toHaveCount(0)
    const promote = page.getByRole('region', { name: 'Pasar a producción' })
    await expect(promote).toContainText(PROD_RELEASE)
    await expect(promote).toContainText(NEW_RELEASE)
    await promote.getByRole('checkbox', { name: 'Revisé el resultado de la prueba' }).check()
    await promote.getByRole('button', { name: 'Pasar a producción' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Pasar a producción la versión de esta propuesta',
    })
    await dialog.getByRole('textbox', { name: 'Dígito 1' }).click()
    await page.keyboard.type('000000')
    await dialog.getByRole('button', { name: 'Pasar a producción' }).click()
    await expect(
      page.getByRole('heading', { name: 'La versión de esta propuesta ya está en producción' }),
    ).toBeVisible()
    expect(served.promotions).toEqual([
      { releaseId: NEW_RELEASE, reason: '', stepUpCode: '000000' },
    ])
    await expect(history).toContainText(`${SEEDED.supervisor.name} la pasó a producción`)

    // The evidence link opens the real case, read-only.
    await cases.getByRole('link', { name: `Abrir el caso ${EVIDENCE_CASE}` }).click()
    await expect(page).toHaveURL(new RegExp(`/supervision/cases/${EVIDENCE_CASE}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: /^Conversación de .+ \(supervisión\)$/ }),
    ).toBeAttached()
    await expect(page.getByText('Solo lectura', { exact: true })).toBeVisible()
  })

  test('in Portuguese the dossier says it is written in Spanish', async ({
    api,
    actors,
    people,
  }) => {
    await api.setAiEnabled(true)
    // A throwaway supervisor: the seeded accounts keep their language.
    const supervisor = await people.person(['supervisor'], ['es', 'pt'])
    const { page, shell } = await actors.signedIn('supervisão', supervisor)
    await shell.chooseLanguage('Português')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await serveEngineProposal(page)
    await page.goto(`/supervision/automation/proposals/${PROPOSAL_ID}`)
    const dossier = page.getByRole('region', { name: 'Relatório do motor de melhoria' })
    await expect(dossier).toContainText('O motor de melhoria escreve este relatório em espanhol.')
    await expect(dossier).toContainText(RECORD.improvement.title)
    await expect(page.getByRole('region', { name: 'Passar para produção' })).toBeVisible()
  })
})

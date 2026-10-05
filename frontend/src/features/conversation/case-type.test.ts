import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCaseDetail } from '@/test/conversation-fixtures'
import { caseRows, caseTypeRow, describeCaseTypeFailure } from './model'

const NOW = '2026-03-05T16:00:00Z'

describe('"Tipo de caso" in the ficha (slice 18)', () => {
  it('is a row only while the AI switch is on, after the priority', () => {
    const detail = makeCaseDetail()
    expect(caseRows(detail, NOW).map((row) => row.key)).not.toContain('case-type')
    expect(caseRows(detail, NOW, { aiEnabled: false }).map((row) => row.key)).not.toContain(
      'case-type',
    )
    const keys = caseRows(detail, NOW, { aiEnabled: true }).map((row) => row.key)
    expect(keys.indexOf('case-type')).toBe(keys.indexOf('priority') + 1)
    expect(caseTypeRow('app_issue')).toEqual({
      key: 'case-type',
      icon: 'tag',
      label: 'Tipo de caso',
      text: 'Problema con app',
      caseType: 'app_issue',
    })
  })

  it('says why a change failed', () => {
    const title = 'No pudimos cambiar el tipo de caso'
    const current = { ...makeCaseDetail().case, caseType: 'virtual_card' as const }
    expect(
      describeCaseTypeFailure(
        new ApiProblem({ status: 409, code: 'version_conflict', extensions: { current } }),
      ),
    ).toEqual({ title, description: 'Alguien más lo cambió: ahora es Tarjeta virtual.' })
    expect(
      describeCaseTypeFailure(new ApiProblem({ status: 409, code: 'version_conflict' })),
    ).toEqual({ title, description: 'Alguien más lo cambió mientras elegías.' })
    expect(describeCaseTypeFailure(new ApiProblem({ status: 409, code: 'case_closed' }))).toEqual({
      title,
      description: 'El caso ya está cerrado.',
    })
    expect(describeCaseTypeFailure(ApiProblem.network()).description).toBe(
      'Revisa tu conexión e inténtalo de nuevo.',
    )
    expect(describeCaseTypeFailure(new Error('boom')).description).toBe('Inténtalo de nuevo.')
  })
})

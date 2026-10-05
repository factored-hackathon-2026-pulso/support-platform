import { describe, expect, it } from 'vitest'
import { CASE_TYPE, CASE_TYPE_OPTIONS, caseType, caseTypeMenuLabel } from './model'
import type { CaseType } from './types'

describe('case types (slice 18)', () => {
  it('are the dataset subcategories, none first and the team-generated one last', () => {
    expect(CASE_TYPE_OPTIONS.map((option) => option.label)).toEqual([
      'Sin tipo',
      'Cargo no reconocido',
      'Cobro indebido',
      'Problema con app',
      'Atención en sucursal',
      'Calidad de servicio',
      'Tarjeta virtual',
    ])
    for (const [value, config] of Object.entries(CASE_TYPE)) expect(config.value).toBe(value)
  })

  it('reads an unknown value as "Sin tipo" and names the menu trigger', () => {
    expect(caseType('fraud' as CaseType)).toBe(CASE_TYPE.none)
    expect(caseTypeMenuLabel('undue_charge')).toBe(
      'Tipo de caso: Cobro indebido. Cambiar el tipo de caso',
    )
  })
})

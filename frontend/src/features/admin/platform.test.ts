import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { aiToggledToast, describeAiToggleFailure, platformChangeFacts } from './platform'

const NOW = '2026-10-04T15:10:00Z'

describe('"Plataforma" copy (slice 18)', () => {
  it('names the last change as facts, or says the installation value applies', () => {
    expect(platformChangeFacts({ updatedAt: null, updatedByName: null }, NOW)).toEqual([
      { key: 'default', icon: 'history', text: 'Valor de la instalación', tone: 'muted' },
    ])
    const facts = platformChangeFacts(
      { updatedAt: '2026-10-04T15:08:00Z', updatedByName: 'Valeria Quintero' },
      NOW,
    )
    expect(facts.map((fact) => [fact.icon, fact.text])).toEqual([
      ['user', 'Valeria Quintero'],
      ['clock', 'hace 2 min'],
    ])
  })

  it('confirms the change and explains a failure', () => {
    expect(aiToggledToast(true).title).toBe('Funciones de IA encendidas')
    expect(aiToggledToast(false)).toEqual({
      title: 'Funciones de IA apagadas',
      description: 'La plataforma atiende solo con personas.',
    })
    expect(describeAiToggleFailure(new ApiProblem({ status: 403, code: 'forbidden' }))).toEqual({
      title: 'No pudimos cambiar las funciones de IA',
      description: 'Ya no tienes el rol de Administración.',
    })
    expect(describeAiToggleFailure(new Error('x')).description).toBe('Inténtalo de nuevo.')
  })
})

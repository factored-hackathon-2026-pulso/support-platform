import { afterEach, describe, expect, it } from 'vitest'
import { formatRelativeTime } from '@/lib/format'
import { changeLocale, currentLocale, i18n } from './i18n'
import { getActiveLocale } from './locale'

afterEach(async () => {
  await changeLocale('es')
})

describe('the i18n instance (slice 23)', () => {
  it('speaks Spanish by default and switches without a reload', async () => {
    expect(currentLocale()).toBe('es')
    expect(i18n.t('shell:nav.queues')).toBe('Colas')
    await changeLocale('pt-BR')
    expect(currentLocale()).toBe('pt-BR')
    expect(i18n.t('shell:nav.queues')).toBe('Filas')
  })

  it('moves the formatters and <html lang> with the language', async () => {
    const now = '2026-10-04T15:10:00Z'
    expect(formatRelativeTime('2026-10-04T15:05:00Z', now)).toBe('hace 5 min')
    await changeLocale('pt-BR')
    expect(getActiveLocale()).toBe('pt-BR')
    expect(document.documentElement.lang).toBe('pt-BR')
    expect(formatRelativeTime('2026-10-04T15:05:00Z', now)).toBe('há 5 min')
  })

  it('pluralises with es / pt rules and groups numbers like the app', async () => {
    expect(i18n.t('shell:rail.pending', { label: 'Casos', count: 1 })).toBe('Casos, 1 pendiente')
    expect(i18n.t('shell:rail.pending', { label: 'Casos', count: 4412 })).toBe(
      'Casos, 4.412 pendientes',
    )
    await changeLocale('pt-BR')
    expect(i18n.t('shell:rail.pending', { label: 'Casos', count: 2 })).toBe('Casos, 2 pendentes')
  })

  it('reads a namespace in a fixed language (the simulator speaks the customer’s)', () => {
    const portuguese = i18n.getFixedT('pt-BR', 'common')
    expect(portuguese('actions.retry')).toBe('Tentar de novo')
    expect(i18n.t('common:actions.retry')).toBe('Reintentar')
  })
})

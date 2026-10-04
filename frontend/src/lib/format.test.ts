import { describe, expect, it } from 'vitest'
import {
  formatLongDate,
  localHour,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
  localDayKey,
  getInitials,
  joinEs,
  maskLast4,
} from './format'

describe('format', () => {
  it('formats money like the canvas', () => {
    expect(formatMoney(1585208, 'COP')).toBe('$1.585.208 COP')
    expect(formatMoney(1500000, 'COP', { withCode: false })).toBe('$1.500.000')
    expect(formatMoney(12400.5, 'MXN')).toBe('$12.400,50 MXN')
    expect(formatMoney(12400, 'ARS')).toBe('$12.400,00 ARS')
    expect(formatMoney(-305909, 'COP')).toBe('-$305.909 COP')
    expect(formatMoney(99.9, 'USD', { fractionDigits: 2 })).toBe('$99,90 USD')
  })

  it('groups thousands even with four digits', () => {
    expect(formatNumber(4412)).toBe('4.412')
    expect(formatNumber(1.2)).toBe('1,2')
    expect(formatPercent(0.28)).toBe('28%')
  })

  it("formats dates in Spanish in the viewer's zone (pinned to Bogotá in tests)", () => {
    const d = '2025-03-05T11:02:00-05:00'
    expect(formatDate(d)).toBe('5 mar 2025')
    expect(formatDate(d, { withYear: false })).toBe('5 mar')
    expect(formatDateTime(d)).toBe('5 mar 2025, 11:02')
    // Same instant written in UTC and in Madrid time.
    expect(formatTime('2025-03-05T16:02:00Z')).toBe('11:02')
    expect(formatTime('2025-03-05T17:02:00+01:00')).toBe('11:02')
    expect(formatTime('2025-03-05T16:02:05Z', { withSeconds: true })).toBe('11:02:05')
    expect(localDayKey('2025-03-06T04:30:00Z')).toBe('2025-03-05')
    expect(localDayKey('2025-03-06T05:00:00Z')).toBe('2025-03-06')
    // 03:30 UTC on the 6th is still the 5th in Bogotá.
    expect(formatDate('2025-03-06T03:30:00Z')).toBe('5 mar 2025')
  })

  it('shows the same instant on the clock of each country the platform serves', () => {
    const instant = '2026-10-02T15:47:00Z'
    expect(formatTime(instant, { timeZone: 'America/Mexico_City' })).toBe('09:47')
    expect(formatTime(instant, { timeZone: 'America/Bogota' })).toBe('10:47')
    expect(formatTime(instant, { timeZone: 'America/Argentina/Buenos_Aires' })).toBe('12:47')
    expect(formatDateTime('2026-10-03T02:30:00Z', { timeZone: 'America/Mexico_City' })).toBe(
      '2 oct 2026, 20:30',
    )
    expect(formatDate('2026-10-03T02:30:00Z', { timeZone: 'America/Argentina/Buenos_Aires' })).toBe(
      '2 oct 2026',
    )
  })

  it('formats relative times compactly against the given now', () => {
    const now = '2025-03-05T11:15:00-05:00'
    expect(formatRelativeTime('2025-03-05T11:13:00-05:00', now)).toBe('hace 2 min')
    expect(formatRelativeTime('2025-03-05T08:15:00-05:00', now)).toBe('hace 3 h')
    expect(formatRelativeTime('2025-03-03T11:15:00-05:00', now)).toBe('hace 2 días')
    expect(formatRelativeTime('2025-03-05T11:24:00-05:00', now)).toBe('en 9 min')
    expect(formatRelativeTime(now, now)).toBe('ahora')
  })

  it('formats durations, masks and initials', () => {
    expect(formatDuration(220)).toBe('3 h 40 min')
    expect(formatDuration(52)).toBe('52 min')
    expect(formatDuration(65)).toBe('1 h 05 min')
    expect(maskLast4('4111111111118501')).toBe('•••• 8501')
    expect(getInitials('Diego Romero Contreras')).toBe('DR')
    expect(getInitials('Samuel Óscar Campos Cruz')).toBe('SC')
    expect(getInitials('Ana Díaz')).toBe('AD')
  })

  it('joins lists in Spanish', () => {
    expect(joinEs([])).toBe('')
    expect(joinEs(['Analista'])).toBe('Analista')
    expect(joinEs(['Analista', 'Supervisión'])).toBe('Analista y Supervisión')
    expect(joinEs(['Analista', 'Supervisión', 'Administración'])).toBe(
      'Analista, Supervisión y Administración',
    )
  })
})

describe('formatLongDate / localHour', () => {
  it('names the day in the viewer zone (tests run in America/Bogota)', () => {
    expect(formatLongDate('2026-10-03T15:00:00Z')).toBe('Sábado 3 de octubre')
    // 02:00 UTC on the 4th is still the 3rd at 21:00 in Bogotá.
    expect(formatLongDate('2026-10-04T02:00:00Z')).toBe('Sábado 3 de octubre')
    expect(formatLongDate('2026-01-05T15:00:00Z', { timeZone: 'UTC' })).toBe('Lunes 5 de enero')
    expect(localHour('2026-10-04T02:00:00Z')).toBe(21)
    expect(localHour('2026-10-04T02:00:00Z', { timeZone: 'UTC' })).toBe(2)
  })
})

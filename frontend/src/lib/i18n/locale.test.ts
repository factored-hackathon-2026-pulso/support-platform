import { describe, expect, it } from 'vitest'
import {
  detectInitialLocale,
  isAppLocale,
  localeFromBrowser,
  readStoredLocale,
  storeLocale,
} from './locale'

describe('UI locale (slice 23)', () => {
  it('knows the two UI languages by their BCP 47 tags', () => {
    expect(isAppLocale('es')).toBe(true)
    expect(isAppLocale('pt-BR')).toBe(true)
    expect(isAppLocale('pt')).toBe(false)
    expect(isAppLocale(null)).toBe(false)
  })

  it('maps a Spanish or Portuguese browser to an app locale, anything else to nothing', () => {
    expect(localeFromBrowser(['pt-PT', 'en'])).toBe('pt-BR')
    expect(localeFromBrowser(['en-US', 'es-MX'])).toBe('es')
    expect(localeFromBrowser(['PT'])).toBe('pt-BR')
    expect(localeFromBrowser(['en-US', 'fr'])).toBeNull()
    expect(localeFromBrowser([])).toBeNull()
  })

  it('before sign-in: the stored choice, else the browser, else Spanish', () => {
    expect(detectInitialLocale('es', ['pt-BR'])).toBe('es')
    expect(detectInitialLocale(null, ['pt-BR'])).toBe('pt-BR')
    expect(detectInitialLocale(null, ['en-GB'])).toBe('es')
  })

  it('remembers the choice in this browser', () => {
    expect(readStoredLocale()).toBeNull()
    storeLocale('pt-BR')
    expect(readStoredLocale()).toBe('pt-BR')
    localStorage.setItem('cc.ui-language', 'fr')
    expect(readStoredLocale()).toBeNull()
  })
})

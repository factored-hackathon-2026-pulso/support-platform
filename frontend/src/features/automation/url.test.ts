import { describe, expect, it } from 'vitest'
import { automationProposalPath, automationTypePath } from '@/app/paths'
import { parseAutomationSearch, toAutomationSearch } from './url'

describe('the Automatización query string', () => {
  it('round-trips the case type and drops unknown values', () => {
    const params = toAutomationSearch({ type: 'undue_charge' })
    expect(params.toString()).toBe('type=undue_charge')
    expect(parseAutomationSearch(params)).toEqual({ type: 'undue_charge' })
    expect(parseAutomationSearch(new URLSearchParams('type=none'))).toEqual({ type: null })
    expect(parseAutomationSearch(new URLSearchParams('type=cobro'))).toEqual({ type: null })
    expect(toAutomationSearch({ type: null }).toString()).toBe('')
  })

  it('matches the links built in paths.ts', () => {
    expect(automationTypePath('app_issue')).toBe('/supervision/automation?type=app_issue')
    expect(automationTypePath()).toBe('/supervision/automation')
    expect(automationProposalPath('p-1', { type: 'undue_charge' })).toBe(
      '/supervision/automation/proposals/p-1?type=undue_charge',
    )
    const search = automationProposalPath('p-1', { type: 'undue_charge' }).split('?')[1]
    expect(parseAutomationSearch(new URLSearchParams(search))).toEqual({ type: 'undue_charge' })
  })
})

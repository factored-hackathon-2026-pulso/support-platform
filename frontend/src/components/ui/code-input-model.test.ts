import { describe, expect, it } from 'vitest'
import { deleteDigit, insertDigits, sanitizeDigits } from './code-input-model'

describe('code input model', () => {
  it('keeps digits only', () => {
    expect(sanitizeDigits('12-3 4a56789', 6)).toBe('123456')
  })

  it('types into the next empty box and never leaves holes', () => {
    expect(insertDigits('', 0, '4', 6)).toEqual({ value: '4', focus: 1 })
    expect(insertDigits('48', 5, '2', 6)).toEqual({ value: '482', focus: 3 })
    expect(insertDigits('482', 1, '9', 6)).toEqual({ value: '492', focus: 2 })
  })

  it('fills every box on paste', () => {
    expect(insertDigits('', 0, '000 000', 6)).toEqual({ value: '000000', focus: 5 })
    expect(insertDigits('12', 2, 'abc', 6)).toEqual({ value: '12', focus: 2 })
  })

  it('deletes the current digit or moves back', () => {
    expect(deleteDigit('482', 1)).toEqual({ value: '42', focus: 1 })
    expect(deleteDigit('482', 3)).toEqual({ value: '48', focus: 2 })
    expect(deleteDigit('', 0)).toEqual({ value: '', focus: 0 })
  })
})

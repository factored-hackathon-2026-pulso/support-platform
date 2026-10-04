import { describe, expect, it } from 'vitest'
import { qrMatrix, qrSvg } from './qr'

describe('qr', () => {
  it('encodes an otpauth URI into a square matrix with the three finder patterns', () => {
    const matrix = qrMatrix(
      'otpauth://totp/LATAM%20Bank%20CC:a%40b.example?secret=JBSWY3DPEHPK3PXP',
    )
    const size = matrix.length
    expect(size).toBeGreaterThanOrEqual(21)
    expect(matrix.every((row) => row.length === size)).toBe(true)
    // Finder patterns: dark corners top-left, top-right and bottom-left.
    expect(matrix[0]?.[0]).toBe(true)
    expect(matrix[0]?.[size - 1]).toBe(true)
    expect(matrix[size - 1]?.[0]).toBe(true)
    expect(qrSvg('hola')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  })
})

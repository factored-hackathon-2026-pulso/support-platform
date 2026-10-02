import { describe, expect, it } from 'vitest'
import { computeBackoff } from './backoff'

describe('computeBackoff', () => {
  const noJitter = { random: () => 1 - Number.EPSILON }

  it('doubles the delay per attempt up to the ceiling', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) =>
      computeBackoff(attempt, { ...noJitter, baseMs: 500, maxMs: 15_000 }),
    )
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000])
  })

  it('applies jitter between 50% and 100% of the ceiling', () => {
    expect(computeBackoff(2, { baseMs: 500, random: () => 0 })).toBe(1000)
    expect(computeBackoff(2, { baseMs: 500, random: () => 0.5 })).toBe(1500)
  })

  it('treats negative or fractional attempts as whole, non-negative numbers', () => {
    expect(computeBackoff(-3, { ...noJitter, baseMs: 200 })).toBe(200)
    expect(computeBackoff(1.7, { ...noJitter, baseMs: 200 })).toBe(400)
  })
})

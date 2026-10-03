import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue, useNow } from './hooks'

describe('shared hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T15:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('useDebouncedValue returns the value only once it stopped changing', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'ab' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ value: 'abc' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('abc')
  })

  it('useNow re-reads the clock every interval while enabled', () => {
    const start = Date.now()
    const { result, rerender } = renderHook(({ enabled }) => useNow(1_000, enabled), {
      initialProps: { enabled: true },
    })
    expect(result.current).toBe(start)
    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current).toBe(start + 1_000)
    rerender({ enabled: false })
    act(() => vi.advanceTimersByTime(5_000))
    expect(result.current).toBe(start + 1_000)
  })
})

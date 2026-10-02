import { describe, expect, it, vi } from 'vitest'
import { createSessionTokenStore } from './session-token'

describe('session token store', () => {
  it('keeps the token in memory and sessionStorage and notifies subscribers', () => {
    const store = createSessionTokenStore()
    const listener = vi.fn<() => void>()
    const unsubscribe = store.subscribe(listener)

    store.set('abc')
    expect(store.get()).toBe('abc')
    expect(sessionStorage.getItem('cc.session.token')).toBe('abc')
    expect(listener).toHaveBeenCalledTimes(1)

    store.set('abc') // no change, no notification
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.clear()
    expect(store.get()).toBeNull()
    expect(sessionStorage.getItem('cc.session.token')).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps each principal under its own storage key', () => {
    const staff = createSessionTokenStore()
    const customer = createSessionTokenStore('cc.customer.token')
    staff.set('staff-token')
    customer.set('customer-token')
    expect(sessionStorage.getItem('cc.session.token')).toBe('staff-token')
    expect(sessionStorage.getItem('cc.customer.token')).toBe('customer-token')
    customer.clear()
    expect(staff.get()).toBe('staff-token')
    expect(createSessionTokenStore('cc.customer.token').get()).toBeNull()
  })

  it('restores the token after a reload of the tab', () => {
    sessionStorage.setItem('cc.session.token', 'persisted')
    expect(createSessionTokenStore().get()).toBe('persisted')
  })
})

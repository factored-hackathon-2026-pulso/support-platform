/**
 * Slice 23: the UI language as a preference of the person. The account menu switches it at
 * once (no reload), saves it with PUT /me/preferences, rolls back on failure; her other
 * sessions follow `preferences.updated`; the sign-in screens remember it.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import { fetchAdminPlatform } from '@/features/admin/api'
import { readStoredLocale } from '@/lib/i18n'
import { envelope } from '@/test/conversation-fixtures'
import { adminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import { preferencesKeys, readPreferences } from './preferences'

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return { ...actual, fetchAdminPlatform: vi.fn<typeof actual.fetchAdminPlatform>() }
})

const fetchMock = vi.mocked(globalThis.fetch)

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** PUT /me/preferences answers with what it got; anything else stays offline. */
function acceptPreferences() {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request
    if (request.url.endsWith('/api/v1/me/preferences') && request.method === 'PUT') {
      return json(200, await request.clone().json())
    }
    throw new TypeError('Network disabled in tests')
  })
}

function preferenceRequests(): Request[] {
  return fetchMock.mock.calls
    .map(([input]) => input as Request)
    .filter((request) => request.url.endsWith('/api/v1/me/preferences'))
}

beforeEach(() => {
  fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network disabled in tests')))
  vi.mocked(fetchAdminPlatform).mockResolvedValue({
    aiEnabled: false,
    agentCoreConfigured: true,
    version: 0,
    updatedAt: null,
    updatedByName: null,
  })
})

async function openAccountMenu(user: ReturnType<typeof renderRoute>['user'], name: RegExp) {
  await user.click(screen.getByRole('button', { name }))
}

describe('the UI language preference', () => {
  it('reads only well-formed preferences.updated payloads', () => {
    expect(readPreferences(envelope('preferences.updated', { uiLanguage: 'pt-BR' }))).toEqual({
      uiLanguage: 'pt-BR',
    })
    expect(readPreferences(envelope('preferences.updated', { uiLanguage: 'pt' }))).toBeNull()
    expect(readPreferences(envelope('preferences.updated', null))).toBeNull()
  })

  it('switches the whole shell to Portuguese from the account menu, without a reload', async () => {
    acceptPreferences()
    const { user, queryClient } = renderRoute('/admin/platform', { staff: adminStaff })
    expect(await screen.findByRole('heading', { level: 1, name: 'Plataforma' })).toBeVisible()
    expect(document.documentElement.lang).toBe('es')

    await openAccountMenu(user, /cambiar de rol/)
    const languages = screen.getByRole('list', { name: 'Idioma de la plataforma' })
    expect(
      within(languages)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Español', 'Português'])
    expect(within(languages).getByRole('button', { name: 'Español' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(languages).getByRole('button', { name: 'Português' }))

    // The shell, the menu and the screen follow at once.
    expect(await screen.findByRole('list', { name: 'Idioma da plataforma' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Português' })).toHaveAttribute('lang', 'pt-BR')
    expect(screen.getByRole('button', { name: 'Português' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('list', { name: 'Trocar de perfil' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Usuários e perfis' })).toBeVisible()
    expect(screen.getByText('Ajustes para toda a equipe')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Funções de IA' })).toBeVisible()
    expect(document.documentElement.lang).toBe('pt-BR')
    expect(document.title).toBe('Plataforma · LATAM Bank Suporte')

    // Saved on her profile, and remembered for the sign-in screens of this browser.
    await waitFor(() => expect(preferenceRequests()).toHaveLength(1))
    const [put] = preferenceRequests()
    expect(put?.method).toBe('PUT')
    expect(await put?.clone().json()).toEqual({ uiLanguage: 'pt-BR' })
    await waitFor(() =>
      expect(queryClient.getQueryData(preferencesKeys.me())).toEqual({ uiLanguage: 'pt-BR' }),
    )
    expect(readStoredLocale()).toBe('pt-BR')
  })

  it('goes back to Spanish and says so when the change cannot be saved', async () => {
    const { user } = renderRoute('/admin/platform', { staff: adminStaff })
    await screen.findByRole('heading', { level: 1, name: 'Plataforma' })
    await openAccountMenu(user, /cambiar de rol/)
    await user.click(screen.getByRole('button', { name: 'Português' }))
    expect(await screen.findByText('No pudimos guardar el idioma')).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(screen.getByRole('link', { name: 'Usuarios y roles' })).toBeVisible()
    expect(document.documentElement.lang).toBe('es')
  })

  it('follows a change made in her other session (preferences.updated)', async () => {
    const { sockets } = renderRoute('/admin/platform', { staff: adminStaff })
    await screen.findByRole('heading', { level: 1, name: 'Plataforma' })
    const socket = sockets.last()
    act(() => socket?.open())
    await waitFor(() =>
      expect(socket?.messages()).toContainEqual({
        action: 'subscribe',
        topic: `staff:${adminStaff.id}`,
      }),
    )
    act(() => socket?.receive(envelope('preferences.updated', { uiLanguage: 'pt-BR' })))
    expect(await screen.findByText('Ajustes para toda a equipe')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Equipes' })).toBeVisible()
  })

  it('starts in her saved language', async () => {
    renderRoute('/admin/platform', { staff: adminStaff, locale: 'pt-BR' })
    expect(await screen.findByText('Ajustes para toda a equipe')).toBeVisible()
    expect(
      screen.getByRole('button', { name: `${adminStaff.name}, trocar de perfil` }),
    ).toBeVisible()
  })
})

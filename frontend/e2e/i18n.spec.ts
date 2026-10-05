import { expect, test } from './support/fixtures'

test.describe('Platform language (slice 23)', () => {
  test('a person switches the platform to Português from her account menu, and it stays after a reload and at the sign-in', async ({
    actors,
    people,
  }) => {
    // A throwaway admin: the seeded accounts never change.
    const admin = await people.person(['admin'], [])
    const { page, shell } = await actors.signedIn('administración', admin)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    // "Plataforma" is a migrated screen: it follows the language with the shell.
    await shell.rail.getByRole('link', { name: 'Plataforma' }).click()
    await expect(page.getByRole('switch', { name: 'Funciones de IA' })).toBeVisible()

    await shell.chooseLanguage('Português')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(shell.rail.getByRole('list', { name: 'Idioma da plataforma' })).toBeVisible()
    await expect(shell.rail.getByRole('link', { name: 'Usuários e perfis' })).toBeVisible()
    await expect(page.getByText('Ajustes para toda a equipe')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Funções de IA' })).toBeVisible()
    await expect(page).toHaveTitle('Plataforma · LATAM Bank Suporte')

    // Saved on her profile: a reload keeps it.
    await page.reload()
    await expect(page.getByText('Ajustes para toda a equipe')).toBeVisible()
    await expect(
      shell.rail.getByRole('button', { name: `${admin.name}, trocar de perfil` }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

    // Signed out, this browser remembers it for the sign-in screens.
    await shell.rail.getByRole('button', { name: `${admin.name}, trocar de perfil` }).click()
    await shell.rail.getByRole('button', { name: 'Sair' }).click()
    await expect(page.getByRole('form', { name: 'Entrar com e-mail' })).toBeVisible()
    await expect(page.getByText('Atendimento ao cliente por chat, do início ao fim.')).toBeVisible()
  })
})

import { SEEDED } from './support/data'
import { expect, test } from './support/fixtures'
import { LoginPage } from './support/pages/login-page'
import { UsersPage } from './support/pages/users-page'

test.describe('Sign-in', () => {
  test('five wrong passwords lock the account until an admin unlocks it', async ({
    actors,
    people,
  }) => {
    const person = await people.analyst(['es'])
    const page = await actors.open('persona')
    const login = new LoginPage(page)
    await login.goto()

    for (const left of [4, 3, 2, 1]) {
      await login.submitPassword(person.email, 'clave-equivocada')
      await expect(login.failure).toContainText(
        left === 1 ? 'Te queda 1 intento' : `Te quedan ${left} intentos`,
      )
      await expect(login.password).toHaveValue('')
    }
    await login.submitPassword(person.email, 'clave-equivocada')
    await expect(page).toHaveURL(/\/login\/locked/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tu cuenta está bloqueada por 15 minutos' }),
    ).toBeVisible()
    await expect(
      page.getByRole('timer', { name: /^Faltan \d+:\d{2} para desbloquear$/ }),
    ).toBeVisible()
    // No self-service reset or SSO: the way out is Administración.
    await expect(
      page.getByText(
        'Pide a Administración que desbloquee tu cuenta o te envíe un enlace para restablecer tu contraseña.',
        {
          exact: false,
        },
      ),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Restablecer|Microsoft/ })).toHaveCount(0)

    // Locked: even the right password is refused.
    await login.goto()
    await login.submitPassword(person.email, person.password)
    await expect(page).toHaveURL(/\/login\/locked/)

    // An admin sees the lock and lifts it.
    const admin = await actors.signedIn('administración', SEEDED.admin)
    const users = new UsersPage(admin.page)
    await users.goto()
    await users.search(person.name)
    await expect(users.row(person.name)).toContainText('Bloqueada')
    const form = await users.select(person.name)
    await form.getByRole('button', { name: 'Desbloquear' }).click()
    await expect(admin.shell.toast('Cuenta desbloqueada')).toBeVisible()
    await expect(users.row(person.name)).toContainText('Activa')

    // She signs in with her password and the code of her authenticator.
    await login.signIn(person.email, person.password, person.totpSecret)
    await expect(page).toHaveURL(/\/analyst/)
  })
})

import { CUSTOMERS, firstName, inventPerson, SEEDED, TEAM_ANDES, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { strongPassword } from './support/api'
import { LoginPage } from './support/pages/login-page'
import { ActivationPage, DevMailboxPage } from './support/pages/onboarding-pages'
import { totpCode } from './support/totp'
import { UsersPage } from './support/pages/users-page'
import { HomePage } from './support/pages/home-page'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Administración', () => {
  test('an admin invites an analyst who activates the account from the email, signs in with her authenticator and receives a case', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.andres
    await customers.release(customer)

    // Administración invites her: no password exists or is shown anywhere.
    const admin = await actors.signedIn('administración', SEEDED.admin)
    const users = new UsersPage(admin.page)
    await users.goto()
    const invited = inventPerson()
    await users.invitePerson({
      ...invited,
      roles: ['Analista'],
      languages: ['es'],
      team: TEAM_ANDES,
    })
    await expect(users.accountForm(invited.name)).toBeVisible()
    await expect(users.row(invited.name)).toContainText('Invitación pendiente')
    await expect(users.aside).toContainText('Invitación enviada')
    await expect(users.aside.getByRole('button', { name: 'Reenviar invitación' })).toBeVisible()

    // She opens the link of her invitation email (the dev mailbox stands in for her inbox).
    const page = await actors.open('analista invitada')
    const mailbox = new DevMailboxPage(page)
    await mailbox.goto()
    await mailbox.openInvitation(invited.email)
    await expect(page).toHaveURL(/\/activar\?token=/)

    // Step 1: her own password; step 2: her authenticator (the test computes the code).
    const activation = new ActivationPage(page)
    const password = strongPassword()
    await activation.setPassword(password)
    const secret = await activation.manualKey()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    await activation.enterCode(totpCode(secret))
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tu cuenta está lista' }),
    ).toBeVisible()
    await expect(page.getByText('Verificación en dos pasos activa')).toBeVisible()

    // The directory follows live: she is active now.
    await expect(users.row(invited.name)).toContainText('Activa')

    const analyst = await people.adopt({
      ...invited,
      password,
      totpSecret: secret,
      roles: ['analyst'],
      languages: ['es'],
    })

    // "Entrar": password + the code of her app (the dev code is not hers to use).
    await page.getByRole('link', { name: 'Entrar' }).click()
    const login = new LoginPage(page)
    await expect(page).toHaveURL(/\/login$/)
    await login.submitPassword(analyst.email, 'clave-equivocada-0')
    await expect(login.failure).toBeVisible()
    await login.submitPassword(analyst.email, analyst.password)
    await login.enterMfa(totpCode(analyst.totpSecret))
    await expect(page).toHaveURL(/\/analista\/inicio$/)
    await expect(new HomePage(page).availability).toContainText('Estás en pausa')
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await expect(workspace.availability('En pausa')).toBeVisible()
    await workspace.becomeAvailable()

    const chat = await actors.customer('cliente', customer)
    const text = uniqueText('Hay un cargo en mi tarjeta que no reconozco')
    await chat.send(text)

    await expect(chat.status({ agent: firstName(analyst.name) })).toBeVisible()
    await workspace.openCase(customer.name)
    await expect(workspace.messages(customer.name).filter({ hasText: text })).toHaveCount(1)
  })

  test('a role change shows up live in the role switcher of the signed-in person', async ({
    actors,
    people,
  }) => {
    const person = await people.analyst(['es'])
    const analyst = await actors.signedIn('analista', person)
    let roles = await analyst.shell.openRoleSwitcher()
    await expect(roles.getByRole('link')).toHaveText(['Analista de casos'])
    await analyst.shell.closeRoleSwitcher()

    const admin = await actors.signedIn('administración', SEEDED.admin)
    const users = new UsersPage(admin.page)
    await users.goto()
    const form = await users.select(person.name)
    await users.roleCheckbox(person.name, 'Supervisión').check()
    await form.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(admin.shell.toast('Cambios guardados')).toBeVisible()

    // No reload, no new sign-in: her shell follows.
    await expect(analyst.shell.toast('Cambiaron tus roles')).toBeVisible()
    await expect(analyst.shell.toast('Ahora tienes: Analista y Supervisión.')).toBeVisible()
    roles = await analyst.shell.openRoleSwitcher()
    await expect(roles.getByRole('link')).toHaveText(['Analista de casos', 'Supervisión'])
    await roles.getByRole('link', { name: 'Supervisión' }).click()
    await expect(analyst.page).toHaveURL(/\/supervision\/colas/)
    await expect(analyst.page.getByRole('heading', { level: 1, name: 'Colas' })).toBeVisible()

    // Taking the role away moves her out of the section she is in.
    await users.roleCheckbox(person.name, 'Supervisión').uncheck()
    await form.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(analyst.page).toHaveURL(/\/analista/)
    await expect(analyst.shell.toast('Ahora tienes: Analista.')).toBeVisible()
    roles = await analyst.shell.openRoleSwitcher()
    await expect(roles.getByRole('link')).toHaveText(['Analista de casos'])
  })

  test('deactivating an account signs that person out of her open window', async ({
    actors,
    people,
  }) => {
    const person = await people.analyst(['es'])
    const analyst = await actors.signedIn('analista', person)
    const workspace = new WorkspacePage(analyst.page)
    await workspace.goto()

    const admin = await actors.signedIn('administración', SEEDED.admin)
    const users = new UsersPage(admin.page)
    await users.goto()
    const form = await users.select(person.name)
    await form.getByRole('button', { name: 'Desactivar cuenta' }).click()
    const confirm = admin.page.getByRole('dialog', {
      name: `¿Desactivar la cuenta de ${person.name}?`,
    })
    await confirm.getByRole('button', { name: 'Desactivar cuenta' }).click()
    await expect(confirm).toBeHidden()
    await expect(admin.shell.toast('Cuenta desactivada')).toBeVisible()

    // Her window is signed out live (socket closed with 4401), back on the sign-in page.
    const login = new LoginPage(analyst.page)
    await expect(analyst.page).toHaveURL(/\/login/)
    await expect(analyst.page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible()

    // And she cannot sign in again.
    await login.submitPassword(person.email, person.password)
    await expect(login.failure).toBeVisible()
    await expect(analyst.page).toHaveURL(/\/login$/)
  })
})

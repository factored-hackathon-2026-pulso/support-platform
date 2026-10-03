import { CUSTOMERS, firstName, inventPerson, SEEDED, TEAM_ANDES, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { LoginPage } from './support/pages/login-page'
import { UsersPage } from './support/pages/users-page'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Administración', () => {
  test('an admin creates an analyst who signs in with the temporary password and receives a case', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.andres
    await customers.release(customer)

    const admin = await actors.signedIn('administración', SEEDED.admin)
    const users = new UsersPage(admin.page)
    await users.goto()
    const invented = inventPerson()
    const password = await users.createPerson({
      ...invented,
      roles: ['Analista'],
      languages: ['es'],
      team: TEAM_ANDES,
    })
    expect(password).toMatch(/^\S{8,}$/)
    await expect(users.accountForm(invented.name)).toBeVisible()
    await expect(users.row(invented.name)).toContainText('Activa')
    const analyst = await people.adopt({
      ...invented,
      password,
      roles: ['analyst'],
      languages: ['es'],
    })

    // She signs in (temporary password + MFA), lands on "Casos" and starts "En pausa".
    const signedIn = await actors.signedIn('analista nueva', analyst)
    await expect(signedIn.page).toHaveURL(/\/analista/)
    const workspace = new WorkspacePage(signedIn.page)
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
    await users.roleCheckbox(person.name, 'Supervisora').check()
    await form.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(admin.shell.toast('Cambios guardados')).toBeVisible()

    // No reload, no new sign-in: her shell follows.
    await expect(analyst.shell.toast('Cambiaron tus roles')).toBeVisible()
    await expect(analyst.shell.toast('Ahora tienes: Analista y Supervisora.')).toBeVisible()
    roles = await analyst.shell.openRoleSwitcher()
    await expect(roles.getByRole('link')).toHaveText(['Analista de casos', 'Supervisora'])
    await roles.getByRole('link', { name: 'Supervisora' }).click()
    await expect(analyst.page).toHaveURL(/\/supervision\/equipo/)
    await expect(
      analyst.page.getByRole('heading', { level: 1, name: 'Equipo y colas' }),
    ).toBeVisible()

    // Taking the role away moves her out of the section she is in.
    await users.roleCheckbox(person.name, 'Supervisora').uncheck()
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

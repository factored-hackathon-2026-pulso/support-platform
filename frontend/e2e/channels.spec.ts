import { CUSTOMERS, firstName, uniqueText } from './support/data'
import { expect, test } from './support/fixtures'
import { WorkspacePage } from './support/pages/workspace-page'

test.describe('Canales simulados · llamada y correo (slice 12)', () => {
  test('the customer calls, the analyst answers, both talk, hold, hang up and close', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.ximena
    await customers.release(customer)
    const analyst = await people.analyst(['es'])
    const agent = firstName(analyst.name)

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()

    // The customer picks "Llamar": it dials at once and rings.
    const phone = await actors.customer('cliente', customer, 'Llamar')
    await expect(phone.callTitle(phone.copy.dialing)).toBeVisible()

    // The case reaches the available analyst; the call rings in her Workspace.
    await expect(workspace.caseCard(customer.name)).toHaveAccessibleName(/Llamada entrante/)
    await workspace.openCase(customer.name)
    await expect(workspace.callState(customer.name, 'Sonando')).toBeVisible()
    await expect(
      workspace.conversation(customer.name).getByRole('button', { name: 'Cerrar caso' }),
    ).toHaveCount(0)
    await workspace.callButton(customer.name, 'Contestar')
    await expect(workspace.callState(customer.name, 'En llamada')).toBeVisible()
    await expect(phone.callTitle(`Te atiende ${agent}`)).toBeVisible()

    // Lines flow both ways, live.
    const hello = uniqueText('Buenas tardes, gracias por llamar a LATAM Bank')
    await workspace.say(customer.name, hello)
    await expect(phone.callLines.filter({ hasText: hello })).toHaveCount(1)
    const problem = uniqueText('Hola, veo un cobro que no reconozco')
    await phone.say(problem)
    await expect(workspace.messages(customer.name).filter({ hasText: problem })).toHaveCount(1)

    // Hold and resume: both sides see it, with the system lines.
    await workspace.callButton(customer.name, 'Poner en espera')
    await expect(workspace.callState(customer.name, 'En espera')).toBeVisible()
    await expect(phone.callTitle(phone.copy.onHold(agent))).toBeVisible()
    await expect(phone.callLines.filter({ hasText: 'Llamada en espera.' })).toHaveCount(1)
    await workspace.callButton(customer.name, 'Retomar')
    await expect(workspace.callState(customer.name, 'En llamada')).toBeVisible()
    await expect(phone.callTitle(`Te atiende ${agent}`)).toBeVisible()
    await expect(
      workspace.messages(customer.name).filter({ hasText: 'La llamada continúa.' }),
    ).toHaveCount(1)

    // A staff-only note never reaches the customer.
    const note = uniqueText('Cliente confirma que no hizo la compra')
    await workspace.addNote(customer.name, note)

    // The analyst hangs up; the case can close now (no "El cliente verá" for a call).
    await workspace.callButton(customer.name, 'Colgar')
    await expect(workspace.callState(customer.name, /^Llamada terminada/)).toBeVisible()
    await expect(phone.callTitle(phone.copy.callEnded)).toBeVisible()
    await expect(phone.page.getByText(note)).toHaveCount(0)

    await workspace.conversation(customer.name).getByRole('button', { name: 'Cerrar caso' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cerrar caso' })
    await expect(dialog.getByText('El cliente verá')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await workspace.closeCase(customer.name, 'Resuelto')

    // The survey still comes after the close, in the call view.
    await expect(phone.survey(agent)).toBeVisible()
  })

  test('the customer emails, the analyst replies by email and the customer reads it', async ({
    actors,
    people,
    customers,
  }) => {
    const customer = CUSTOMERS.natalia
    await customers.release(customer)
    const analyst = await people.analyst(['es'])
    const agent = firstName(analyst.name)

    const { page } = await actors.signedIn('analista', analyst)
    const workspace = new WorkspacePage(page)
    await workspace.goto()
    await workspace.becomeAvailable()

    const mail = await actors.customer('cliente', customer, 'Escribir un correo')
    const subject = uniqueText('Cobro duplicado en mi tarjeta')
    const body = uniqueText('Hola, aparece dos veces el mismo cobro en mi resumen')
    await mail.email(body, subject)

    // The analyst: an email case, the thread with the subject and the new email.
    await expect(workspace.caseCard(customer.name)).toHaveAccessibleName(/Correo/)
    const conversation = await workspace.openCase(customer.name)
    await expect(conversation.getByRole('heading', { level: 3, name: subject })).toBeVisible()
    const incoming = workspace.messages(customer.name).filter({ hasText: body })
    await expect(incoming).toHaveCount(1)
    await expect(incoming).toContainText('Nuevo')
    const form = conversation.getByRole('form', { name: 'Responder por correo' })
    await expect(form).toContainText(`Re: ${subject}`)
    await expect(form).toContainText('El saludo y la firma se agregan solos')
    await expect(form.getByRole('button', { name: 'Adjuntar archivo, pronto' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    const answer = uniqueText('Ya pedimos el reverso del cobro duplicado')
    await workspace.replyByEmail(customer.name, answer)
    // Framed by the platform: greeting with her first name and the analyst's signature.
    const sent = workspace.messages(customer.name).filter({ hasText: answer })
    await expect(sent).toContainText(`Hola, ${firstName(customer.name)}:`)
    await expect(sent).toContainText(analyst.name)
    await expect(incoming).not.toContainText('Nuevo')

    // The customer reads the reply in the same thread, marked "Nuevo".
    const reply = mail.mails.filter({ hasText: answer })
    await expect(reply).toHaveCount(1)
    await expect(reply).toContainText(mail.copy.newMark)
    await expect(reply).toContainText(`${agent}`)

    // And answers in the thread: the analyst gets it live.
    const thanks = uniqueText('Gracias, quedo atenta')
    await mail.email(thanks)
    await expect(workspace.messages(customer.name).filter({ hasText: thanks })).toHaveCount(1)
  })
})

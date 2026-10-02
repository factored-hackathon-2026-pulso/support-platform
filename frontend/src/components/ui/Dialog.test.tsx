import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { SegmentedControl } from './SegmentedControl'
import { Sheet } from './Sheet'

function CloseCaseDialog() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Cerrar caso</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Cerrar el caso"
        description="Ana Díaz Rodríguez · CMP-U3LCK9M349ONZ620WFQE"
        footerNote="Queda en auditoría"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary">Cerrar caso</Button>
          </>
        }
      >
        <p>Contenido</p>
      </Dialog>
    </>
  )
}

/** "Cerrar caso" that removes its own trigger on confirm (the Workspace switches case). */
function RemovesTrigger() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  if (done) return <p>Caso cerrado</p>
  return (
    <>
      <Button onClick={() => setOpen(true)}>Cerrar caso</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Cerrar el caso"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false)
              setDone(true)
            }}
          >
            Confirmar
          </Button>
        }
      />
    </>
  )
}

describe('Dialog', () => {
  it('does not try to restore focus to a trigger that is gone', async () => {
    const user = userEvent.setup()
    render(<RemovesTrigger />)
    const trigger = screen.getByRole('button', { name: 'Cerrar caso' })
    await user.click(trigger)
    const focus = vi.spyOn(trigger, 'focus')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(screen.getByText('Caso cerrado')).toBeInTheDocument()
    expect(focus).not.toHaveBeenCalled()
  })

  it('opens as a labelled modal and moves focus inside', async () => {
    const user = userEvent.setup()
    render(<CloseCaseDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar caso' }))
    const dialog = screen.getByRole('dialog', { name: 'Cerrar el caso' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Ana Díaz Rodríguez · CMP-U3LCK9M349ONZ620WFQE')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<CloseCaseDialog />)
    const trigger = screen.getByRole('button', { name: 'Cerrar caso' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes from the close button and keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<CloseCaseDialog />)
    await user.click(screen.getByRole('button', { name: 'Cerrar caso' }))
    const dialog = screen.getByRole('dialog')

    for (let i = 0; i < 5; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stacks a Dialog over a Sheet: only the top layer reacts', async () => {
    const user = userEvent.setup()
    render(<SheetWithConfirm />)
    await user.click(screen.getByRole('button', { name: 'Ver tema' }))
    await user.click(screen.getByRole('button', { name: 'Descartar tema' }))
    const dialog = screen.getByRole('dialog', { name: '¿Descartar el tema?' })

    // Clicking inside the top dialog does not close the sheet below it.
    await user.click(screen.getByText('Se puede recuperar desde Auditoría.'))
    expect(screen.getByRole('dialog', { name: 'Fraude con tarjeta' })).toBeInTheDocument()

    // Tab cycles through the dialog only.
    for (let i = 0; i < 4; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    // Escape closes the dialog only and returns focus to the sheet.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '¿Descartar el tema?' })).not.toBeInTheDocument()
    const sheet = screen.getByRole('dialog', { name: 'Fraude con tarjeta' })
    expect(screen.getByRole('button', { name: 'Descartar tema' })).toHaveFocus()
    expect(sheet.closest('[data-modal-backdrop]')).not.toHaveAttribute('inert')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('wraps Tab on the last tabbable control, ignoring unchecked radios', async () => {
    const user = userEvent.setup()
    render(<DialogEndingInSegmented />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = screen.getByRole('dialog')
    screen.getByRole('radio', { name: 'Hoy' }).focus()
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
  })
})

function SheetWithConfirm() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setSheetOpen(true)}>Ver tema</Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Fraude con tarjeta">
        <Button onClick={() => setConfirmOpen(true)}>Descartar tema</Button>
      </Sheet>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Descartar el tema?"
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="primary">Descartar</Button>
          </>
        }
      >
        <p>Se puede recuperar desde Auditoría.</p>
      </Dialog>
    </>
  )
}

function DialogEndingInSegmented() {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState('today')
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Periodo">
        <SegmentedControl
          label="Periodo"
          value={range}
          onValueChange={setRange}
          options={[
            { value: 'today', label: 'Hoy' },
            { value: 'week', label: 'Semana' },
          ]}
        />
      </Dialog>
    </>
  )
}

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { TOAST_DURATION, ToastProvider } from './Toast'
import { useToast, type ToastOptions } from './toast-context'
import { useToastClearance } from './use-toast-clearance'

function Trigger({ label = 'Avisar', options }: { label?: string; options: ToastOptions }) {
  const { toast } = useToast()
  return <Button onClick={() => toast(options)}>{label}</Button>
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces through the persistent status region and runs the action, then dismisses it', async () => {
    const user = userEvent.setup()
    const onReview = vi.fn<() => void>()
    render(
      <ToastProvider>
        <Trigger
          options={{
            tag: 'Nuevo',
            meta: 'Cola de soporte · hace 1 min',
            title: 'Te llegó un caso nuevo',
            actions: [
              { label: 'Ver caso', onClick: onReview },
              { label: 'Más tarde', onClick: () => {} },
            ],
          }}
        />
      </ToastProvider>,
    )
    // Live regions exist before any toast, so insertions are announced.
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    expect(screen.getByRole('region', { name: 'Avisos' })).toContainElement(status)

    await user.click(screen.getByRole('button', { name: 'Avisar' }))
    expect(status).toHaveTextContent('Te llegó un caso nuevo')

    await user.click(screen.getByRole('button', { name: 'Ver caso' }))
    expect(onReview).toHaveBeenCalledOnce()
    expect(status).toBeEmptyDOMElement()
  })

  it('puts alert toasts in the assertive region', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Trigger options={{ title: 'No se pudo guardar', politeness: 'alert' }} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Avisar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('auto-dismisses after the default duration', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger options={{ title: 'Caso guardado' }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Avisar' }))
    expect(screen.getByRole('status')).toHaveTextContent('Caso guardado')
    act(() => vi.advanceTimersByTime(TOAST_DURATION))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does not restart the timers of other toasts when one is added', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger label="A" options={{ title: 'Aviso A' }} />
        <Trigger label="B" options={{ title: 'Aviso B' }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    act(() => vi.advanceTimersByTime(5000))
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    act(() => vi.advanceTimersByTime(1000))
    const status = screen.getByRole('status')
    expect(status).not.toHaveTextContent('Aviso A')
    expect(status).toHaveTextContent('Aviso B')
  })

  it('pauses while hovered and resumes with the time left', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger options={{ title: 'Caso guardado' }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Avisar' }))
    const item = screen.getByText('Caso guardado').closest('.shadow-toast')!
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.mouseEnter(item)
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('status')).toHaveTextContent('Caso guardado')
    fireEvent.mouseLeave(item)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('sits below open modals and rises above a bottom-docked composer while it is mounted', () => {
    function Composer() {
      return <div ref={useToastClearance<HTMLDivElement>()}>Composer</div>
    }
    function Page({ composer }: { composer: boolean }) {
      return composer ? <Composer /> : null
    }
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: window.innerHeight - 140, height: 140 } as DOMRect)
    const { rerender } = render(
      <ToastProvider>
        <Page composer />
      </ToastProvider>,
    )
    const region = screen.getByRole('region', { name: 'Avisos' })
    // Dialog and Sheet backdrops are z-50.
    expect(region).toHaveClass('z-40')
    expect(region).toHaveStyle({ bottom: '152px' })
    rerender(
      <ToastProvider>
        <Page composer={false} />
      </ToastProvider>,
    )
    expect(region).toHaveStyle({ bottom: '24px' })
    rect.mockRestore()
  })
})

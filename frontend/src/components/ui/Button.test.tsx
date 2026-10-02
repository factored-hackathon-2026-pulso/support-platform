import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { Button, LinkButton } from './Button'
import { IconButton } from './IconButton'

describe('Button', () => {
  it('renders a type="button" by default and handles clicks', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    render(<Button onClick={onClick}>Mover</Button>)
    const button = screen.getByRole('button', { name: 'Mover' })
    expect(button).toHaveAttribute('type', 'button')
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is busy and disabled while loading', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    render(
      <Button loading onClick={onClick}>
        Guardar cambios
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('LinkButton renders a real link with button styling', async () => {
    const { router, user } = renderWithProviders(
      <LinkButton to="/supervisora/aprobaciones" variant="accent">
        Revisar
      </LinkButton>,
    )
    const link = await screen.findByRole('link', { name: 'Revisar' })
    expect(link).toHaveAttribute('href', '/supervisora/aprobaciones')
    expect(link).toHaveClass('bg-accent')
    await user.click(link)
    expect(router.state.location.pathname).toBe('/supervisora/aprobaciones')
  })
})

describe('IconButton', () => {
  it('uses the aria-label as accessible name and tooltip', () => {
    render(<IconButton aria-label="Contraer el panel" icon={<svg />} />)
    const button = screen.getByRole('button', { name: 'Contraer el panel' })
    expect(button).toHaveAttribute('title', 'Contraer el panel')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Accordion, AccordionItem } from './Accordion'

function ClientFile() {
  return (
    <Accordion defaultValue="products">
      <AccordionItem value="products" title="Productos" count={2}>
        Tarjeta Crédito •••• 8501
      </AccordionItem>
      <AccordionItem value="complaints" title="Reclamos" count={1}>
        Cargo no reconocido
      </AccordionItem>
      <AccordionItem value="contact" title="Contacto" count={3}>
        Celular •••• 1871
      </AccordionItem>
    </Accordion>
  )
}

describe('Accordion', () => {
  it('keeps a single section open at a time', async () => {
    const user = userEvent.setup()
    render(<ClientFile />)
    const products = screen.getByRole('button', { name: /Productos/ })
    const complaints = screen.getByRole('button', { name: /Reclamos/ })

    expect(products).toHaveAttribute('aria-expanded', 'true')
    expect(complaints).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Tarjeta Crédito •••• 8501')).toBeVisible()

    await user.click(complaints)
    expect(complaints).toHaveAttribute('aria-expanded', 'true')
    expect(products).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Cargo no reconocido')).toBeVisible()
    expect(screen.queryByText('Tarjeta Crédito •••• 8501')).not.toBeInTheDocument()
  })

  it('collapses the open section when clicked again', async () => {
    const user = userEvent.setup()
    render(<ClientFile />)
    const products = screen.getByRole('button', { name: /Productos/ })
    await user.click(products)
    expect(products).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getAllByRole('button').every((b) => b.getAttribute('aria-expanded') === 'false'),
    ).toBe(true)
  })

  it('links each trigger with its panel without adding landmarks', () => {
    render(<ClientFile />)
    const products = screen.getByRole('button', { name: /Productos/ })
    const panelId = products.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId!)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

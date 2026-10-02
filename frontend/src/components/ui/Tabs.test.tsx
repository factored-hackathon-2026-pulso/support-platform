import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tab, TabList, TabPanel, Tabs } from './Tabs'

function SupportTabs({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <Tabs defaultValue="copilot" onValueChange={onValueChange}>
      <TabList aria-label="Paneles">
        <Tab value="copilot">Copiloto</Tab>
        <Tab value="tools">Herramientas</Tab>
        <Tab value="client" dot>
          Cliente
        </Tab>
      </TabList>
      <TabPanel value="copilot">Panel copiloto</TabPanel>
      <TabPanel value="tools">Panel herramientas</TabPanel>
      <TabPanel value="client">Panel cliente</TabPanel>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('wires tablist, tabs and panels with ARIA', () => {
    render(<SupportTabs />)
    expect(screen.getByRole('tablist', { name: 'Paneles' })).toBeInTheDocument()
    const copilot = screen.getByRole('tab', { name: 'Copiloto' })
    expect(copilot).toHaveAttribute('aria-selected', 'true')
    expect(copilot).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Herramientas' })).toHaveAttribute('tabindex', '-1')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Panel copiloto')
    expect(panel).toHaveAccessibleName('Copiloto')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveTextContent('con alertas')
  })

  it('selects a tab on click', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn<(value: string) => void>()
    render(<SupportTabs onValueChange={onValueChange} />)
    await user.click(screen.getByRole('tab', { name: 'Herramientas' }))
    expect(screen.getByRole('tab', { name: 'Herramientas' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel herramientas')
    expect(onValueChange).toHaveBeenCalledWith('tools')
  })

  it('moves focus and selection with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    render(<SupportTabs />)
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Copiloto' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Herramientas' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Herramientas' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel cliente')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Copiloto' })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Copiloto' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the tablist reachable when no tab is selected', async () => {
    const user = userEvent.setup()
    render(
      <Tabs>
        <TabList aria-label="Paneles">
          <Tab value="copilot">Copiloto</Tab>
          <Tab value="tools">Herramientas</Tab>
        </TabList>
        <TabPanel value="copilot">Panel copiloto</TabPanel>
      </Tabs>,
    )
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Copiloto' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Herramientas' })).not.toHaveAttribute('aria-controls')
  })
})

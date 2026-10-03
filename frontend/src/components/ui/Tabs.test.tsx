import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tab, TabList, TabPanel, Tabs } from './Tabs'

function SampleTabs({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <Tabs defaultValue="mensajes" onValueChange={onValueChange}>
      <TabList aria-label="Paneles">
        <Tab value="mensajes">Mensajes</Tab>
        <Tab value="history">Historial</Tab>
        <Tab value="client" dot>
          Cliente
        </Tab>
      </TabList>
      <TabPanel value="mensajes">Panel mensajes</TabPanel>
      <TabPanel value="history">Panel historial</TabPanel>
      <TabPanel value="client">Panel cliente</TabPanel>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('wires tablist, tabs and panels with ARIA', () => {
    render(<SampleTabs />)
    expect(screen.getByRole('tablist', { name: 'Paneles' })).toBeInTheDocument()
    const messages = screen.getByRole('tab', { name: 'Mensajes' })
    expect(messages).toHaveAttribute('aria-selected', 'true')
    expect(messages).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('tabindex', '-1')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Panel mensajes')
    expect(panel).toHaveAccessibleName('Mensajes')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveTextContent('con alertas')
  })

  it('selects a tab on click', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn<(value: string) => void>()
    render(<SampleTabs onValueChange={onValueChange} />)
    await user.click(screen.getByRole('tab', { name: 'Historial' }))
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel historial')
    expect(onValueChange).toHaveBeenCalledWith('history')
  })

  it('moves focus and selection with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    render(<SampleTabs />)
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Mensajes' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel cliente')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Mensajes' })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Cliente/ })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Mensajes' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the tablist reachable when no tab is selected', async () => {
    const user = userEvent.setup()
    render(
      <Tabs>
        <TabList aria-label="Paneles">
          <Tab value="mensajes">Mensajes</Tab>
          <Tab value="history">Historial</Tab>
        </TabList>
        <TabPanel value="mensajes">Panel mensajes</TabPanel>
      </Tabs>,
    )
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Mensajes' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Historial' })).not.toHaveAttribute('aria-controls')
  })
})

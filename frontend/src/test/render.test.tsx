import { screen } from '@testing-library/react'
import { useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from './render'

function AgentId() {
  const { agentId } = useParams()
  return <span>Agente {agentId ?? 'sin id'}</span>
}

describe('renderWithProviders', () => {
  it('mounts the UI at `path` so route params resolve', () => {
    renderWithProviders(<AgentId />, {
      route: '/automatizacion/agentes/AGT-1',
      path: '/automatizacion/agentes/:agentId',
    })
    expect(screen.getByText('Agente AGT-1')).toBeInTheDocument()
  })
})

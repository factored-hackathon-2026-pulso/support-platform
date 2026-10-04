import { screen } from '@testing-library/react'
import { useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from './render'

function CaseId() {
  const { caseId } = useParams()
  return <span>Caso {caseId ?? 'sin id'}</span>
}

describe('renderWithProviders', () => {
  it('mounts the UI at `path` so route params resolve', () => {
    renderWithProviders(<CaseId />, {
      route: '/supervision/cases/CASE-1',
      path: '/supervision/cases/:caseId',
    })
    expect(screen.getByText('Caso CASE-1')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QueryState, type QueryLike } from './QueryState'

function renderState<T>(query: QueryLike<T>) {
  return render(
    <QueryState query={query} skeleton={<span>Cargando colas</span>} empty={<span>Sin colas</span>}>
      {(data) => <span>Colas: {String(data)}</span>}
    </QueryState>,
  )
}

describe('QueryState', () => {
  it('shows the skeleton while pending', () => {
    renderState({ status: 'pending', data: undefined, refetch: vi.fn<() => unknown>() })
    expect(screen.getByText('Cargando colas').parentElement).toHaveAttribute('aria-busy', 'true')
  })

  it('shows an alert with a retry button on error', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn<() => unknown>()
    renderState({ status: 'error', data: undefined, refetch })
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar esta información')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('shows the empty state for an empty list and the content otherwise', () => {
    const { rerender } = renderState<string[]>({
      status: 'success',
      data: [],
      refetch: vi.fn<() => unknown>(),
    })
    expect(screen.getByText('Sin colas')).toBeInTheDocument()
    rerender(
      <QueryState
        query={{ status: 'success', data: ['Disputas'], refetch: vi.fn<() => unknown>() }}
        skeleton={null}
        empty={<span>Sin colas</span>}
      >
        {(data) => <span>Colas: {data.join(', ')}</span>}
      </QueryState>,
    )
    expect(screen.getByText('Colas: Disputas')).toBeInTheDocument()
  })
})

/** The primitives' own copy follows the UI language (slice 23). */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setTestLocale } from '@/test/render'
import { CodeInput } from './CodeInput'
import { Dialog } from './Dialog'
import { FilterChips, FilterMenu } from './FilterMenu'
import { IconButton } from './IconButton'
import { languagesName } from './language'
import { QueryState } from './QueryState'
import { Spinner } from './Spinner'
import { ToastProvider } from './Toast'

beforeEach(() => {
  setTestLocale('pt-BR')
})

describe('primitives in Brazilian Portuguese', () => {
  it('names loading, retry and alerts in Portuguese', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn<() => unknown>()
    render(
      <>
        <Spinner />
        <IconButton aria-label="Avisos" icon={<span />} dot />
        <QueryState query={{ status: 'error', data: undefined, refetch }} skeleton={null}>
          {() => null}
        </QueryState>
      </>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Carregando')
    expect(screen.getByRole('button', { name: 'Avisos, com alertas' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível carregar estas informações',
    )
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('names the dialog close, the code digits, the filters and the toasts in Portuguese', () => {
    render(
      <ToastProvider>
        <CodeInput value="" onChange={() => undefined} label="Código" length={2} />
        <FilterMenu
          groups={[{ key: 'g', legend: 'Grupo', options: [{ value: 'a', label: 'A' }] }]}
          selection={{ g: ['a'] }}
          onToggle={() => undefined}
          onClear={() => undefined}
        />
        <FilterChips
          chips={[{ groupKey: 'g', value: 'a', label: 'A' }]}
          onRemove={() => undefined}
          onClear={() => undefined}
        />
        <Dialog open onOpenChange={() => undefined} title="Título">
          <p>Corpo</p>
        </Dialog>
      </ToastProvider>,
    )
    expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover filtro A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Avisos', hidden: true })).toBeInTheDocument()
  })

  it('joins language names with the Portuguese "e"', () => {
    expect(languagesName(['pt', 'es'])).toBe('Español e Português')
  })
})

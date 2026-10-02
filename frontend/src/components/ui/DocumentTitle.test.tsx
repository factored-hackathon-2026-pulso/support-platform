import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentTitle } from './DocumentTitle'
import { formatDocumentTitle } from './document-title'

describe('DocumentTitle', () => {
  it('formats "page · product"', () => {
    expect(formatDocumentTitle('Entrar')).toBe('Entrar · LATAM Bank Soporte')
    expect(formatDocumentTitle('  ')).toBe('LATAM Bank Soporte')
    expect(formatDocumentTitle(null)).toBe('LATAM Bank Soporte')
  })

  it('sets the tab title over the static one and follows the screen', () => {
    const fallback = document.createElement('title')
    fallback.textContent = 'LATAM Bank Soporte'
    document.head.append(fallback)

    const { rerender, unmount } = render(<DocumentTitle title="Entrar" />)
    expect(document.title).toBe('Entrar · LATAM Bank Soporte')
    rerender(<DocumentTitle title="Por aprobar" />)
    expect(document.title).toBe('Por aprobar · LATAM Bank Soporte')
    unmount()
    expect(document.title).toBe('LATAM Bank Soporte')
    fallback.remove()
  })
})

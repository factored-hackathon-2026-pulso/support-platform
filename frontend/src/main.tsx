import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { prefetchNamespaces } from '@/lib/i18n'
import { AppProviders } from '@/app/providers'
import { createAppRouter } from '@/app/router'
import '@/styles/index.css'

const router = createAppRouter()

const container = document.getElementById('root')
if (!container) throw new Error('The #root element was not found.')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)

// The catalogs outside the entry chunk, fetched in the background once the first screen is up,
// so later screens never wait for their copy (slice 23).
void prefetchNamespaces()

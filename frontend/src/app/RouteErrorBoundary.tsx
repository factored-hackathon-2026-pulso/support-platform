import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router'
import { TriangleAlert } from 'lucide-react'
import { Button, DocumentTitle, EmptyState, LinkButton } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

/** A lazy route chunk that failed to download (new deploy, network drop). */
function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(
      error.message,
    )
  )
}

/**
 * Route-level error boundary. Each lazy page gets it, so a crash in one screen
 * keeps the rail usable. "Reintentar" re-renders the screen in place (the
 * router resets the boundary on a new location) and keeps the query cache; only
 * a failed chunk download needs a full reload. "Ir al inicio" goes to `/`,
 * which sends a signed-in user to their first role home (RootRedirect).
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()
  const location = useLocation()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const { t } = useTranslation(['shell', 'common'])

  function retry() {
    if (isChunkLoadError(error)) {
      window.location.reload()
      return
    }
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: location.state as unknown },
    )
  }

  if (import.meta.env.DEV && !notFound) console.error(error)

  const detail = isRouteErrorResponse(error)
    ? // i18n-ignore-next-line: a development-only detail
      `Error ${error.status}: ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null

  return (
    <div role="alert" className="flex h-full grow items-center justify-center bg-canvas">
      <DocumentTitle title={notFound ? t('routeError.notFoundTab') : t('routeError.errorTab')} />
      <EmptyState
        icon={<TriangleAlert size={40} strokeWidth={1.6} />}
        title={notFound ? t('routeError.notFoundTitle') : t('routeError.errorTitle')}
        description={
          <>
            {notFound ? t('routeError.notFoundText') : t('routeError.errorText')}
            {detail && import.meta.env.DEV ? (
              <span className="mt-2 block font-mono text-12 text-muted">{detail}</span>
            ) : null}
          </>
        }
        action={
          <>
            {notFound ? null : (
              <Button variant="primary" onClick={retry}>
                {t('common:actions.retry')}
              </Button>
            )}
            <LinkButton to="/" variant="secondary">
              {t('routeError.goHome')}
            </LinkButton>
          </>
        }
      />
    </div>
  )
}

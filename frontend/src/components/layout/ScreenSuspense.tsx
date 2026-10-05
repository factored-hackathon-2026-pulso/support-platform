import { Suspense, type ReactNode } from 'react'
import { Spinner } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

function ScreenLoading() {
  const { t } = useTranslation('shell')
  return (
    <div className="flex h-full min-h-40 grow items-center justify-center text-ink-2">
      <Spinner label={t('loadingScreen')} size={24} />
    </div>
  )
}

/**
 * The screen area of a layout while a translation chunk loads (slice 23: catalogs other than
 * `common` and `shell` are lazy). The rail or the brand panel stay on screen around it.
 */
export function ScreenSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
}

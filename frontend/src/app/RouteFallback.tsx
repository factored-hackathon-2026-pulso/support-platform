import { Spinner } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

/**
 * Shown in place of a lazy route while its chunk downloads on the first load
 * (react-router `HydrateFallback`). Ancestors (guards, AppShell with the rail,
 * AuthLayout) are already rendered around it, so a cold load never shows a blank page.
 */
export function RouteFallback() {
  const { t } = useTranslation('shell')
  return (
    <div className="flex h-full min-h-40 grow items-center justify-center text-ink-2">
      <Spinner label={t('loadingScreen')} size={24} />
    </div>
  )
}

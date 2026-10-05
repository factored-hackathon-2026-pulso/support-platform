/**
 * The copy of "Plataforma" (slice 18: the AI switch), from the `admin` catalog
 * (`admin:platform.*`, slice 23). Pure: read when a function runs.
 */
import type { FactItem } from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { formatRelativeTime } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type { AdminPlatformSettings } from './types'

const t = i18n.getFixedT(null, 'admin', 'platform')

/** What the AI switch does, under its name (one line). */
export function aiSwitchDescription(): string {
  return t('aiDescription')
}

/**
 * The last change as short facts (slice 6 UI rule: icon + 1–3 words, never a dot-joined
 * line): who, and when (clock). Never changed: "Valor de la instalación".
 */
export function platformChangeFacts(
  settings: Pick<AdminPlatformSettings, 'updatedAt' | 'updatedByName'>,
  now: Date | string | number,
): FactItem[] {
  if (!settings.updatedAt) {
    return [{ key: 'default', icon: 'history', text: t('installationValue'), tone: 'muted' }]
  }
  return [
    {
      key: 'by',
      icon: 'user',
      text: settings.updatedByName ?? t('someone'),
      label: t('lastChange'),
    },
    {
      key: 'at',
      icon: 'clock',
      text: formatRelativeTime(settings.updatedAt, now),
      label: t('when'),
    },
  ]
}

/** The toast after turning it on or off, for the admin herself. */
export function aiToggledToast(enabled: boolean): { title: string; description: string } {
  return enabled
    ? { title: t('onTitle'), description: t('onText') }
    : { title: t('offTitle'), description: t('offText') }
}

/** The toast when the switch could not change (it shows the previous state again). */
export function describeAiToggleFailure(error: unknown): { title: string; description: string } {
  const title = t('failedTitle')
  if (isApiProblem(error)) {
    if (error.code === 'forbidden') return { title, description: t('failedForbidden') }
    if (error.code === 'network_error') return { title, description: t('failedNetwork') }
  }
  return { title, description: t('failedOther') }
}

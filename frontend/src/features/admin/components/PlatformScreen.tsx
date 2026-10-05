import { useId } from 'react'
import { Sparkles } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { Callout, Card, FactList, PageHeader, QueryState, Skeleton, Switch } from '@/components/ui'
import { useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import { useAdminPlatform, useSetAiEnabled } from '../hooks'
import { aiSwitchDescription, platformChangeFacts } from '../platform'
import type { AdminPlatformSettings } from '../types'

/** The "hace 2 min" of the last change ticks with the screen. */
const TICK_MS = 30_000

/**
 * "Plataforma" (slice 18): the settings that apply to everyone. Today one switch, "Funciones
 * de IA": off, the platform is exactly the people-only one (new chats go to people, no
 * copilot, no builder, no case types); on, the AI layer acts where agent-core is wired. A
 * change is audited and every connected person sees it at once.
 */
export function PlatformScreen() {
  const settings = useAdminPlatform()
  const { t } = useTranslation('admin', { keyPrefix: 'platform' })
  return (
    <Page header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
      <PageBody>
        <QueryState query={settings} skeleton={<Skeleton className="h-24 max-w-[640px]" />}>
          {(data) => <AiSwitchCard settings={data} />}
        </QueryState>
      </PageBody>
    </Page>
  )
}

function AiSwitchCard({ settings }: { settings: AdminPlatformSettings }) {
  const titleId = useId()
  const descriptionId = useId()
  const now = useNow(TICK_MS)
  const toggle = useSetAiEnabled()
  const { t } = useTranslation('admin', { keyPrefix: 'platform' })
  return (
    <Card padding="md" className="flex max-w-[640px] flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-8 bg-accent-soft text-accent-strong"
        >
          <Sparkles size={16} />
        </span>
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h2 id={titleId} className="m-0 text-15 font-semibold">
            {t('aiTitle')}
          </h2>
          <p id={descriptionId} className="m-0 text-13 text-ink-2">
            {aiSwitchDescription()}
          </p>
        </div>
        <Switch
          checked={settings.aiEnabled}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
          disabled={toggle.isPending}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="mt-1"
        />
      </div>
      <FactList items={platformChangeFacts(settings, now)} size="sm" className="pl-11" />
      {settings.aiEnabled && !settings.agentCoreConfigured ? (
        <Callout tone="neutral" title={t('engineMissing')}>
          {t('engineMissingText')}
        </Callout>
      ) : null}
    </Card>
  )
}

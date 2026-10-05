import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { Bot } from 'lucide-react'
import { usePlatformSettings } from '@/app/platform'
import { PATHS } from '@/app/paths'
import { Page } from '@/components/layout'
import { Button, Callout, PageHeader, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { useBuilderAvailable } from '../hooks/use-automation'
import type { AgentRequest } from '../builder-chat'
import type { MaturingType } from '../types'
import { BuilderChatSheet } from './BuilderChat'
import { BuilderChatContext, type BuilderChatRequest } from './chat-panel'

export type AutomationSection = 'types' | 'agents' | 'proposals'

interface ChatState {
  open: boolean
  request: AgentRequest | null
  type: MaturingType | null
  fresh: boolean
  /** A new key per opening: the sheet starts with that opening's request. */
  key: number
}

export interface Crumb {
  label: string
  /** A link back up; the last crumb (the page) has none. */
  to?: string
}

export interface AutomationFrameProps {
  section: AutomationSection
  /** The path above the page ("Automatización / Cobro indebido / Propuesta"). */
  crumbs?: readonly Crumb[]
  title: ReactNode
  subtitle?: ReactNode
  /** Tab title when `title` is a node. */
  documentTitle?: string
  actions?: ReactNode
  children: ReactNode
}

/**
 * The frame of every Automatización screen (IaAutomatizacion): the path, the title, the sections
 * (Tipos de caso, Agentes, Propuestas) and the chat with the builder agent, which any screen can
 * open. Only while the AI functions are on (`AutomationGate`).
 */
export function AutomationFrame({
  section,
  crumbs = [],
  title,
  subtitle,
  documentTitle,
  actions,
  children,
}: AutomationFrameProps) {
  const { t } = useTranslation('automation')
  const builder = useBuilderAvailable()
  const [chat, setChat] = useState<ChatState>({
    open: false,
    request: null,
    type: null,
    fresh: false,
    key: 0,
  })
  const open = useCallback(
    ({ request = null, type = null, fresh = false }: BuilderChatRequest = {}) =>
      setChat((current) => ({ open: true, request, type, fresh, key: current.key + 1 })),
    [],
  )
  const control = useMemo(() => ({ open }), [open])
  return (
    <BuilderChatContext.Provider value={control}>
      <Page
        header={
          <PageHeader
            eyebrow={crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : undefined}
            title={title}
            subtitle={subtitle}
            // The screens' intros are whole sentences: they wrap, never cut with "…".
            wrapSubtitle
            documentTitle={documentTitle}
            actions={
              <div className="flex items-center gap-2">
                {actions}
                {builder ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Bot size={16} />}
                    onClick={() => open()}
                  >
                    {t('chat.open')}
                  </Button>
                ) : null}
              </div>
            }
          />
        }
        toolbar={<SectionNav section={section} />}
      >
        {children}
      </Page>
      {builder ? (
        <BuilderChatSheet
          key={chat.key}
          open={chat.open}
          request={chat.request}
          type={chat.type}
          fresh={chat.fresh}
          onOpenChange={(next) => setChat((current) => ({ ...current, open: next }))}
        />
      ) : null}
    </BuilderChatContext.Provider>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { t } = useTranslation('automation')
  return (
    <nav aria-label={t('breadcrumbs')}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-13 text-ink-2">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1.5">
            {crumb.to ? (
              <Link to={crumb.to} className="text-ink-2 hover:text-link">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-ink">
                {crumb.label}
              </span>
            )}
            {index < crumbs.length - 1 ? (
              <span aria-hidden="true" className="text-muted">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}

const SECTION_PATH: Record<AutomationSection, string> = {
  types: PATHS.supervision.automation,
  agents: PATHS.supervision.automationAgents,
  proposals: PATHS.supervision.automationProposals,
}

function SectionNav({ section }: { section: AutomationSection }) {
  const { t } = useTranslation('automation')
  return (
    <nav
      aria-label={t('sections')}
      className="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-7 py-2.5"
    >
      {(['types', 'agents', 'proposals'] as const).map((key) => (
        <Link
          key={key}
          to={SECTION_PATH[key]}
          aria-current={key === section ? 'page' : undefined}
          className={cn(
            'rounded-8 px-3 py-1.5 text-13 font-medium transition-colors',
            key === section ? 'bg-ink text-white' : 'text-ink hover:bg-subtle',
          )}
        >
          {t(`tabs.${key}`)}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Automatización exists only while the AI functions are on: unknown yet → a spinner; off (or
 * turned off while she is here) → back to Colas, the landing of Supervisión.
 */
export function AutomationGate({ children }: { children: ReactNode }) {
  const settings = usePlatformSettings()
  if (settings === undefined) {
    return (
      <div className="flex grow items-center justify-center p-10">
        <Spinner />
      </div>
    )
  }
  if (!settings.aiEnabled) return <Navigate to={PATHS.supervision.queues} replace />
  return <>{children}</>
}

/** "El motor de IA no está conectado": the builder's parts need agent-core. */
export function EngineMissing({ className }: { className?: string }) {
  const { t } = useTranslation('automation')
  return (
    <Callout tone="neutral" title={t('engine.title')} className={className}>
      {t('engine.text')}
    </Callout>
  )
}

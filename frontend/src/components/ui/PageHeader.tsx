import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { DocumentTitle } from './DocumentTitle'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /**
   * Let a long subtitle (an explanatory sentence) wrap instead of cutting it with "…". Short
   * subtitles stay on one line by default.
   */
  wrapSubtitle?: boolean
  /** Buttons, filters or a summary link at the right. */
  actions?: ReactNode
  /** Element before the title (back link, kicker). */
  eyebrow?: ReactNode
  /**
   * Browser tab title. Defaults to `title` when it is a string; pass it when the
   * title is a node (e.g. "Agente · Disputas" for a composed heading).
   */
  documentTitle?: string
  className?: string
}

/** Page title bar: display-font h1 (22px), subtitle and actions, bottom border. Sets the tab title. */
export function PageHeader({
  title,
  subtitle,
  wrapSubtitle = false,
  actions,
  eyebrow,
  documentTitle,
  className,
}: PageHeaderProps) {
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : null)
  return (
    <header
      className={cn(
        'flex shrink-0 items-center justify-between gap-4 border-b border-border px-7 py-4',
        className,
      )}
    >
      {tabTitle ? <DocumentTitle title={tabTitle} /> : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow}
        <h1 className="m-0 truncate font-display text-22 font-bold">{title}</h1>
        {subtitle ? (
          <p
            className={cn(
              'm-0 text-13 text-ink-2',
              wrapSubtitle ? 'max-w-[110ch] text-pretty' : 'truncate',
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  )
}

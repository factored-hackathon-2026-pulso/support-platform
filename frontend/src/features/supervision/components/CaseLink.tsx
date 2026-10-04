import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { supervisionCasePath } from '@/app/paths'
import { buttonClasses } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface CaseLinkProps {
  caseId: string
  /** Plain left click: the screen opens the case view (the route adds the return URL). */
  onOpen(caseId: string): void
  /** `text`: an inline name; `button`: looks like a small secondary button ("Ver conversación"). */
  variant?: 'text' | 'button'
  /** Name when the visible text is not enough ("Ver conversación de {cliente}"). */
  'aria-label'?: string
  className?: string
  children: ReactNode
}

/**
 * A real link to the supervisor case view (middle click / new tab work), whose
 * plain click is handed to the screen so the route can carry the return URL
 * (`state.from`, contract §8.1).
 */
export function CaseLink({
  caseId,
  onOpen,
  variant = 'text',
  'aria-label': ariaLabel,
  className,
  children,
}: CaseLinkProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(caseId)
  }
  return (
    <Link
      to={supervisionCasePath(caseId)}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        variant === 'button'
          ? buttonClasses({ variant: 'secondary', size: 'sm' })
          : 'text-ink hover:text-accent-strong hover:underline',
        className,
      )}
    >
      {children}
    </Link>
  )
}

import type { ReactNode } from 'react'
import { DocumentTitle } from '@/components/ui'

export interface AuthHeadingProps {
  title: string
  subtitle?: ReactNode
  /** Line above the title ("correo · No soy yo"). */
  eyebrow?: ReactNode
}

/** 30px display h1 + 15px lead used by every login step (BoLogin / BoMfa / BoLocked). Sets the tab title. */
export function AuthHeading({ title, subtitle, eyebrow }: AuthHeadingProps) {
  return (
    <div className="flex flex-col gap-2">
      <DocumentTitle title={title} />
      {eyebrow}
      <h1 className="m-0 font-display text-30 font-bold text-balance">{title}</h1>
      {subtitle ? <p className="m-0 text-15 leading-[1.5] text-ink-2">{subtitle}</p> : null}
    </div>
  )
}

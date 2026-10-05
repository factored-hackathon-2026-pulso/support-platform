import { Bot } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface StageBarsProps {
  bars: readonly boolean[]
  /** An agent serves the type: the bot glyph after the bars. */
  agent?: boolean
  className?: string
}

/** The three stage bars of a case type (IaAutomatizacion): decoration, the label says the stage. */
export function StageBars({ bars, agent = false, className }: StageBarsProps) {
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {bars.map((filled, index) => (
        <span
          key={index}
          data-filled={filled || undefined}
          className={cn('h-1 w-3 rounded-[2px]', filled ? 'bg-accent-strong' : 'bg-border')}
        />
      ))}
      {agent ? <Bot size={13} className="ml-1 shrink-0 text-accent-strong" /> : null}
    </span>
  )
}

import { CircleCheck, CircleX } from 'lucide-react'
import { Callout } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { reportView } from '../proposals'
import type { EvalReport } from '../types'

export interface EvaluationReportProps {
  report: EvalReport
  /** The gate failed now: the proposal went back to draft (the 409's report). */
  failedNow?: boolean
}

/**
 * The test of a proposal (IaAutomatizacion `prueba` on slice 16's evaluation): the verdict and each
 * gate item apart, never a composite score. The canvas's 50 past cases compared with the team are
 * not what agent-core's evaluation returns: its scenarios and metrics are shown as they come.
 */
export function EvaluationReport({ report, failedNow = false }: EvaluationReportProps) {
  const { t } = useTranslation('automation')
  const view = reportView(report)
  return (
    <section aria-labelledby="proposal-report" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="proposal-report" className="m-0 text-15 font-semibold">
          {t('proposal.report')}
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-14 font-semibold',
            view.passed ? 'text-success-ink' : 'text-danger',
          )}
        >
          {view.passed ? (
            <CircleCheck size={16} aria-hidden="true" />
          ) : (
            <CircleX size={16} aria-hidden="true" />
          )}
          {view.passed ? t('proposal.passed') : t('proposal.failed')}
          <span className="font-normal text-ink-2">{view.summary}</span>
        </span>
      </div>
      {failedNow ? <Callout tone="warn">{t('proposal.failedText')}</Callout> : null}
      {view.items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-border-soft rounded-12 border border-border bg-surface p-0">
          {view.items.map((item) => (
            <li key={item.key} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-13">{item.metric}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-13 font-medium',
                    item.passed ? 'text-success-ink' : 'text-danger',
                  )}
                >
                  {item.passed ? (
                    <CircleCheck size={14} aria-hidden="true" />
                  ) : (
                    <CircleX size={14} aria-hidden="true" />
                  )}
                  {item.verdict}
                </span>
              </span>
              {item.facts.length > 0 ? (
                <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-12 text-ink-2">
                  {item.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              ) : null}
              {item.reason ? <span className="text-13 text-ink-2">{item.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import { Callout, TBody, TCell, TH, THead, TRow, Table } from '@/components/ui'
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
 * The test of a proposal (IaAutomatizacion `prueba` on slice 16's evaluation): the verdict, what
 * the gate decided, and each gate item apart with the current version's value against this
 * proposal's and the floor (never a composite score). Failed items come first. The canvas's 50
 * past cases compared with the team are not what agent-core's evaluation returns.
 */
export function EvaluationReport({ report, failedNow = false }: EvaluationReportProps) {
  const { t } = useTranslation('automation')
  const view = reportView(report)
  const DecisionIcon =
    view.decisionTone === 'success'
      ? CircleCheck
      : view.decisionTone === 'danger'
        ? CircleX
        : CircleAlert
  return (
    <section aria-labelledby="proposal-report" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="proposal-report" className="m-0 text-15 font-semibold">
          {t('proposal.report')}
        </h2>
        <span className="inline-flex items-center gap-3 text-14">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-semibold',
              view.passed ? 'text-success-ink' : 'text-danger',
            )}
          >
            {view.passed ? (
              <CircleCheck size={16} aria-hidden="true" />
            ) : (
              <CircleX size={16} aria-hidden="true" />
            )}
            {view.passed ? t('proposal.passed') : t('proposal.failed')}
          </span>
          <span className="text-ink-2">{view.summary}</span>
        </span>
      </div>
      {failedNow ? (
        <Callout tone="warn">{t('proposal.failedText')}</Callout>
      ) : (
        <p
          className={cn(
            'm-0 inline-flex items-start gap-1.5 text-13',
            view.decisionTone === 'success' && 'text-success-ink',
            view.decisionTone === 'danger' && 'text-danger',
            view.decisionTone === 'warn' && 'text-warn',
          )}
        >
          <DecisionIcon size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {view.decision}
        </p>
      )}
      {view.items.length > 0 ? (
        <Table aria-label={t('proposal.report')} density="comfortable">
          <THead>
            <TRow>
              <TH>{t('proposal.columns.criterion')}</TH>
              <TH>{t('proposal.columns.base')}</TH>
              <TH>{t('proposal.columns.candidate')}</TH>
              <TH>{t('proposal.columns.floor')}</TH>
              <TH>{t('proposal.columns.result')}</TH>
            </TRow>
          </THead>
          <TBody>
            {view.items.map((item) => (
              <TRow key={item.key}>
                <TCell>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-13">{item.metric}</span>
                    <span className="text-12 text-muted">{item.phase}</span>
                    {item.reason ? <span className="text-12 text-ink-2">{item.reason}</span> : null}
                  </span>
                </TCell>
                <TCell className="font-mono text-13 text-ink-2">{item.base}</TCell>
                <TCell className="font-mono text-13">{item.candidate}</TCell>
                <TCell className="font-mono text-13 text-ink-2">{item.floor}</TCell>
                <TCell>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-13 font-medium whitespace-nowrap',
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
                </TCell>
              </TRow>
            ))}
          </TBody>
        </Table>
      ) : null}
    </section>
  )
}

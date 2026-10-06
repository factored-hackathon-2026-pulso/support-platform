import { useState, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { useProposalStep, useRelease, type ProposalStep } from '../hooks/use-automation'
import {
  REASON_CODES,
  describeBuilderFailure,
  isMissingSuite,
  isReasonCode,
  newIdempotencyKey,
  reasonCodeLabel,
  suiteFor,
  type BuilderFailure,
  type EndStep,
} from '../proposals'
import type {
  AliasState,
  EvalReport,
  MaturingType,
  ProposalDetail,
  ReasonCode,
  Violation,
  YardstickChange,
} from '../types'
import { ActivatePanel } from './ActivatePanel'
import { PromotePanel } from './PromotePanel'
import { StepUpDialog } from './StepUpDialog'

export interface GateResult {
  report: EvalReport | null
  /** The gate failed: the proposal went back to draft. */
  failed: boolean
}

export interface ProposalNextStepProps {
  detail: ProposalDetail
  type: MaturingType | null
  onGateResult(result: GateResult | null): void
  /** "Activar" chose the type the agent serves (the URL keeps it). */
  onTypeChosen(type: MaturingType): void
  /** How a published proposal ends: "Activar" or "Pasar a producción". */
  endStep: EndStep
  /** The agent's `prod` alias (null: nowhere; undefined: not known yet). */
  prod: AliasState | null | undefined
  /** The release this proposal published, from its history. */
  publishedReleaseId: string | null
}

type Decision = 'approve' | 'reject'

/** The next step of a proposal by its state (slice 16 §2), with the decisions' dialogs. */
export function ProposalNextStep({
  detail,
  type,
  onGateResult,
  onTypeChosen,
  endStep,
  prod,
  publishedReleaseId,
}: ProposalNextStepProps) {
  const { t } = useTranslation('automation')
  const { proposal } = detail
  const step = useProposalStep(proposal.proposalId)
  const { toast } = useToast()
  const [notice, setNotice] = useState<string | null>(null)
  const [violations, setViolations] = useState<Violation[] | null>(null)
  const [noSuite, setNoSuite] = useState(false)
  const [decision, setDecision] = useState<Decision | null>(null)
  const baseRelease = useRelease(proposal.state === 'candidate' ? proposal.baseReleaseId : null)
  const suite = suiteFor(detail.changes, baseRelease.data)

  /** A refusal outside a dialog: in words, or the structure it carries. */
  function handle(failure: BuilderFailure) {
    if (failure.kind === 'violations') {
      setViolations(failure.violations)
      return
    }
    if (failure.kind === 'gateFailed') {
      onGateResult({ report: failure.report, failed: true })
      return
    }
    if (failure.kind === 'conflict') {
      toast({ title: t('proposal.stale') })
      return
    }
    setNotice('message' in failure ? failure.message : t('failure.generic'))
  }

  function run(next: ProposalStep, onDone?: (data: unknown) => void) {
    setNotice(null)
    setViolations(null)
    step.mutate(next, {
      onSuccess: (data) => onDone?.(data),
      onError: (error) => {
        if (next.kind === 'evaluate' && isMissingSuite(error)) {
          setNoSuite(true)
          return
        }
        handle(describeBuilderFailure(error))
      },
    })
  }

  let body: ReactNode = null
  switch (proposal.state) {
    case 'draft':
      body = (
        <>
          {detail.lastDecision?.decision === 'rejected' ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-13 text-ink-2">
              {t('proposal.lastRejected')}
              {detail.lastDecision.reasonCode ? (
                <Badge tone="neutral">{reasonCodeLabel(detail.lastDecision.reasonCode)}</Badge>
              ) : null}
            </p>
          ) : null}
          <p className="m-0 text-13 text-ink-2">{t('proposal.editHint')}</p>
          <Actions>
            <Button
              variant="secondary"
              onClick={() =>
                run({ kind: 'validate' }, (data) => {
                  const report = data as { violations: Violation[] }
                  if (report.violations.length > 0) setViolations(report.violations)
                  else setNotice(t('proposal.validated'))
                })
              }
              loading={step.isPending && step.variables?.kind === 'validate'}
            >
              {t('proposal.validate')}
            </Button>
            <Button
              variant="primary"
              onClick={() => run({ kind: 'freeze' }, () => onGateResult(null))}
              loading={step.isPending && step.variables?.kind === 'freeze'}
            >
              {t('proposal.freeze')}
            </Button>
          </Actions>
        </>
      )
      break
    case 'candidate':
      body = (
        <>
          {suite === null || noSuite ? (
            <Callout tone="warn" title={t('proposal.noSuiteTitle')}>
              {t('proposal.noSuiteText')}
            </Callout>
          ) : null}
          {step.isPending && step.variables?.kind === 'evaluate' ? (
            <output className="block text-13 text-ink-2">{t('proposal.testing')}</output>
          ) : null}
          <Actions>
            <Button variant="ghost" onClick={() => run({ kind: 'reopen' })}>
              {t('proposal.reopen')}
            </Button>
            {suite !== null && !noSuite ? (
              <Button
                variant="primary"
                loading={step.isPending && step.variables?.kind === 'evaluate'}
                onClick={() =>
                  run(
                    { kind: 'evaluate', suiteId: suite.suiteId, suiteVersion: suite.suiteVersion },
                    () => onGateResult(null),
                  )
                }
              >
                {t('proposal.test')}
              </Button>
            ) : null}
          </Actions>
        </>
      )
      break
    case 'evaluated':
      body = (
        <Actions>
          <Button variant="ghost" onClick={() => run({ kind: 'reopen' })}>
            {t('proposal.reopen')}
          </Button>
          <Button variant="secondary" onClick={() => setDecision('reject')}>
            {t('proposal.reject')}
          </Button>
          <Button variant="primary" onClick={() => setDecision('approve')}>
            {t('proposal.approve')}
          </Button>
        </Actions>
      )
      break
    case 'approved':
      // Approving publishes in the same step: an approved proposal is one whose publication failed.
      body = (
        <>
          <Callout tone="warn">{t('proposal.approvedPending')}</Callout>
          <Actions>
            <Button variant="ghost" onClick={() => run({ kind: 'reopen' })}>
              {t('proposal.reopen')}
            </Button>
            <Button variant="primary" onClick={() => setDecision('approve')}>
              {t('proposal.retry')}
            </Button>
          </Actions>
        </>
      )
      break
    case 'published':
      return endStep === 'promote' && prod ? (
        <PromotePanel detail={detail} prod={prod} publishedReleaseId={publishedReleaseId} />
      ) : (
        <ActivatePanel detail={detail} type={type} onTypeChosen={onTypeChosen} />
      )
  }

  return (
    <Card as="section" padding="md" aria-labelledby="proposal-next" className="flex flex-col gap-3">
      <h2 id="proposal-next" className="m-0 text-15 font-semibold">
        {t('proposal.nextStep')}
      </h2>
      {notice ? <output className="block text-13 text-ink-2">{notice}</output> : null}
      {violations && violations.length > 0 ? <Violations violations={violations} /> : null}
      {body}
      {decision ? (
        <DecisionDialog
          decision={decision}
          detail={detail}
          endStep={endStep}
          onClose={() => setDecision(null)}
          onDone={(message) => {
            setDecision(null)
            toast({ title: message })
          }}
        />
      ) : null}
    </Card>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
}

function Violations({ violations }: { violations: Violation[] }) {
  const { t } = useTranslation('automation')
  return (
    <Callout tone="danger" title={t('proposal.violations')} role="note">
      <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
        {violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>
            <span className="font-mono text-12">{violation.rule}</span> {violation.message}
          </li>
        ))}
      </ul>
    </Callout>
  )
}

interface DecisionDialogProps {
  decision: Decision
  detail: ProposalDetail
  endStep: EndStep
  onClose(): void
  onDone(message: string): void
}

/**
 * Approve (which also publishes) or reject: each asks for one fresh code (and approve, the
 * yardstick warning).
 */
function DecisionDialog({ decision, detail, endStep, onClose, onDone }: DecisionDialogProps) {
  const { t } = useTranslation('automation')
  const { proposal } = detail
  const step = useProposalStep(proposal.proposalId)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null)
  const [loosened, setLoosened] = useState<YardstickChange[] | null>(null)
  const [accept, setAccept] = useState(false)
  // One key per publication she means to make: a retry of this dialog reuses it.
  const [idempotencyKey] = useState(newIdempotencyKey)

  const label = decision === 'approve' ? t('proposal.approve') : t('proposal.reject')

  function confirm(code: string) {
    setError(null)
    const next: ProposalStep =
      decision === 'approve'
        ? {
            kind: 'approve',
            candidateHash: proposal.candidateHash ?? '',
            acceptYardstickLoosened: accept,
            stepUpCode: code,
            idempotencyKey,
          }
        : {
            kind: 'reject',
            reason: reason.trim(),
            reasonCode: reasonCode ?? 'other',
            stepUpCode: code,
          }
    step.mutate(next, {
      onSuccess: () =>
        onDone(
          decision === 'reject'
            ? t('proposal.rejected')
            : endStep === 'promote'
              ? t('proposal.publishedPromote')
              : t('proposal.published'),
        ),
      onError: (failure) => {
        const described = describeBuilderFailure(failure)
        if (described.kind === 'loosening') {
          setLoosened(described.changes)
          return
        }
        setError(
          'message' in described
            ? described.message
            : described.kind === 'gateFailed'
              ? t('proposal.failed')
              : t('failure.generic'),
        )
      },
    })
  }

  return (
    <StepUpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={label}
      description={proposal.title}
      confirmLabel={label}
      pending={step.isPending}
      error={error}
      confirmDisabled={
        (decision === 'reject' && (reason.trim() === '' || reasonCode === null)) ||
        (loosened !== null && !accept)
      }
      onConfirm={confirm}
    >
      {decision === 'reject' ? (
        <Field label={t('proposal.rejectCode')} hint={t('proposal.rejectCodeHint')} required>
          <Select
            placeholder={t('proposal.rejectCodePlaceholder')}
            value={reasonCode ?? ''}
            options={REASON_CODES.map((code) => ({ value: code, label: reasonCodeLabel(code) }))}
            onChange={(event) => {
              const chosen = event.target.value
              setReasonCode(isReasonCode(chosen) ? chosen : null)
            }}
          />
        </Field>
      ) : null}
      {decision === 'reject' ? (
        <Field label={t('proposal.rejectReason')} hint={t('proposal.rejectHint')} required>
          <Textarea
            value={reason}
            rows={3}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      ) : null}
      {proposal.state === 'approved' ? (
        <Callout tone="warn">{t('proposal.approvedPending')}</Callout>
      ) : null}
      {loosened ? (
        <Callout tone="warn" title={t('proposal.loosened')} role="note">
          <p className="m-0">{t('proposal.loosenedText')}</p>
          <ul className="m-0 mt-1 flex list-disc flex-col gap-1 pl-4">
            {loosened.map((change, index) => (
              <li key={`${change.target}-${index}`}>{change.message}</li>
            ))}
          </ul>
          <Checkbox
            className="mt-2"
            label={t('proposal.acceptLoosened')}
            checked={accept}
            onChange={(event) => setAccept(event.target.checked)}
          />
        </Callout>
      ) : null}
    </StepUpDialog>
  )
}

import type { ReactNode, Ref } from 'react'
import { CircleArrowUp, Copy, History, PanelRight, PhoneOutgoing } from 'lucide-react'
import { Button, FactList, IconButton, Status, useToast } from '@/components/ui'
import { caseStatus } from '@/features/cases'
import { useTranslation } from '@/lib/i18n'
import {
  canEscalate,
  CUSTOMER_FILE_PANEL_ID,
  CUSTOMER_FILE_TRIGGER_ID,
  SUPPORT_PANEL_TRIGGER_ID,
  caseHeaderFacts,
  customerFileTriggerLabel,
  previousCasesLabel,
  shortCaseId,
} from '../model'
import type { CaseDetail } from '../types'

/**
 * The header wraps instead of squeezing: when the name and the case number do not fit next to
 * the actions (the right panel open, a long name, longer Portuguese labels), the actions move to
 * a second row on the right, and they wrap among themselves on a very narrow column. The name
 * is only truncated when it does not fit even on its own row.
 */
const HEADER_CLASS =
  'flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-3.5'
const IDENTITY_CLASS = 'flex min-w-0 flex-auto flex-col gap-0.5'

export interface CaseHeaderProps {
  detail: CaseDetail
  onRequestClose: () => void
  /** "Escalar a supervisión" (slice 9): absent = no button (supervision mode). */
  onRequestEscalate?: () => void
  /** "Llamar al cliente" (slice 12): absent = no button (supervision mode). */
  onRequestCall?: () => void
  /** "Casos anteriores (n)": opens the customer's case history (absent = no button). */
  onOpenHistory?: () => void
  /** The customer-name heading (focusable with `tabIndex=-1`): the Workspace moves focus here on a programmatic case switch. */
  headingRef?: Ref<HTMLHeadingElement>
  /** Extra actions in the header (the supervisor's "Asignar" / "Reasignar"). */
  actions?: ReactNode
  /** Hide "Cerrar caso" even for the assignee (supervision mode never closes). */
  hideClose?: boolean
  /**
   * The Workspace's slim header (slice 6 §5): only the name, which opens "Ficha
   * del cliente", and the case number with "Copiar". The meta line and "Casos
   * anteriores (n)" move into the panel. Absent = the full header (supervision).
   */
  customerFile?: { open: boolean; onToggle(): void }
  /**
   * Slice 20 (AI on): "Apoyo" opens or closes the right panel at "Copiloto" (IaWorkspace: the
   * copilot, the tools and the customer).
   */
  supportPanel?: { open: boolean; onToggle(): void }
}

/**
 * Case header (contract §9.3): name; short id (copyable), then the place, the channel icon
 * and the "[PT]" language mark as facts; "Casos anteriores
 * (n)" when the customer has other cases; "Cerrar caso" for the assignee, or the
 * "Cerrado" status on a closed case (the full header always shows the status). The supervisor view adds its "Asignar" /
 * "Reasignar" (`actions`) and never offers "Cerrar caso". The meta line wraps instead of being
 * truncated: the "[PT]" mark is the only cue outside the transcript that the
 * analyst must reply in Portuguese (rule 3).
 */
export function CaseHeader({
  detail,
  onRequestClose,
  onRequestEscalate,
  onRequestCall,
  onOpenHistory,
  headingRef,
  actions,
  hideClose = false,
  customerFile,
  supportPanel,
}: CaseHeaderProps) {
  // `cases` too: the header shows the shared case vocabulary (the status).
  const { t } = useTranslation(['conversation', 'cases'])
  const { case: summary, capabilities } = detail
  const { toast } = useToast()
  const closed = summary.status === 'closed'
  const historyLabel = previousCasesLabel(detail.previousCaseCount)
  // Slice 12: a case never closes with a call on the line (the backend says call_in_progress).
  const callOn = Boolean(summary.activeCallId || detail.activeCall)

  function copyId() {
    void navigator.clipboard?.writeText(summary.id).then(
      () => toast({ title: t('header.copied'), description: summary.id, duration: 3000 }),
      () => undefined,
    )
  }

  const caseNumber = (
    <>
      <span className="font-mono" title={summary.id}>
        <span aria-hidden="true">{shortCaseId(summary.id)}</span>
        <span className="sr-only">{summary.id}</span>
      </span>
      <IconButton
        size="sm"
        variant="ghost"
        className="-my-1.5 size-6 text-muted"
        aria-label={t('header.copy')}
        icon={<Copy size={13} aria-hidden="true" />}
        onClick={copyId}
      />
    </>
  )

  const rightSide = (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
      {closed || !customerFile ? (
        <Status {...caseStatus(summary.inboxStatus)} srLabel={t('header.status')} />
      ) : null}
      {actions}
      {supportPanel ? (
        <Button
          id={SUPPORT_PANEL_TRIGGER_ID}
          variant="secondary"
          icon={<PanelRight size={15} aria-hidden="true" />}
          aria-expanded={supportPanel.open}
          aria-controls={supportPanel.open ? CUSTOMER_FILE_PANEL_ID : undefined}
          title={t('header.supportTitle')}
          className={supportPanel.open ? 'bg-panel' : undefined}
          onClick={supportPanel.onToggle}
        >
          {t('header.support')}
        </Button>
      ) : null}
      {historyLabel && onOpenHistory && !customerFile ? (
        <Button
          variant="secondary"
          icon={<History size={15} aria-hidden="true" />}
          onClick={onOpenHistory}
        >
          {historyLabel}
        </Button>
      ) : null}
      {onRequestCall && !hideClose && capabilities.canCall && !callOn ? (
        <Button
          variant="secondary"
          icon={<PhoneOutgoing size={15} aria-hidden="true" />}
          onClick={onRequestCall}
        >
          {t('header.call')}
        </Button>
      ) : null}
      {onRequestEscalate && !hideClose && canEscalate(detail) ? (
        <Button
          variant="secondary"
          icon={<CircleArrowUp size={15} aria-hidden="true" />}
          onClick={onRequestEscalate}
        >
          {t('header.escalate')}
        </Button>
      ) : null}
      {!closed && !hideClose && capabilities.canClose && !callOn ? (
        <Button variant="secondary" onClick={onRequestClose}>
          {t('header.close')}
        </Button>
      ) : null}
    </div>
  )

  if (customerFile) {
    const name = summary.customer.displayName
    return (
      <header className={HEADER_CLASS}>
        <div className={IDENTITY_CLASS}>
          {/* The heading keeps the plain name (the button inside says what it does). */}
          <h2
            ref={headingRef}
            tabIndex={-1}
            aria-label={name}
            className="m-0 min-w-0 text-17 font-semibold focus-visible:outline-offset-4"
          >
            <button
              id={CUSTOMER_FILE_TRIGGER_ID}
              type="button"
              aria-label={customerFileTriggerLabel(name)}
              aria-expanded={customerFile.open}
              aria-controls={customerFile.open ? CUSTOMER_FILE_PANEL_ID : undefined}
              onClick={customerFile.onToggle}
              className="max-w-full cursor-pointer truncate rounded-8 text-left underline decoration-border decoration-2 underline-offset-4 hover:decoration-ink-2"
            >
              {name}
            </button>
          </h2>
          <p className="m-0 flex items-center gap-x-1 text-13 text-ink-2">{caseNumber}</p>
        </div>
        {rightSide}
      </header>
    )
  }

  return (
    <header className={HEADER_CLASS}>
      <div className={IDENTITY_CLASS}>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 truncate text-17 font-semibold focus-visible:outline-offset-4"
        >
          {summary.customer.displayName}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-2">
          <p className="m-0 flex items-center gap-x-1">{caseNumber}</p>
          <FactList items={caseHeaderFacts(detail)} aria-label={t('header.facts')} />
        </div>
      </div>
      {rightSide}
    </header>
  )
}

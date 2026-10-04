import type { ReactNode, Ref } from 'react'
import { Copy, History } from 'lucide-react'
import { Badge, Button, IconButton, SampleDataTag, useToast } from '@/components/ui'
import {
  CUSTOMER_FILE_PANEL_ID,
  CUSTOMER_FILE_TRIGGER_ID,
  caseHeaderMeta,
  customerFileTriggerLabel,
  previousCasesLabel,
  shortCaseId,
} from '../model'
import type { CaseDetail } from '../types'

export interface CaseHeaderProps {
  detail: CaseDetail
  onRequestClose: () => void
  /** "Casos anteriores (n)": opens the customer's case history (absent = no button). */
  onOpenHistory?: () => void
  /** The customer-name heading (focusable with `tabIndex=-1`): the Workspace moves focus here on a programmatic case switch. */
  headingRef?: Ref<HTMLHeadingElement>
  /** Extra actions before "Datos de ejemplo" (the supervisor's "Asignar" / "Reasignar"). */
  actions?: ReactNode
  /** Hide "Cerrar caso" even for the assignee (supervision mode never closes). */
  hideClose?: boolean
  /**
   * The Workspace's slim header (slice 6 §5): only the name, which opens "Ficha
   * del cliente", and the case number with "Copiar". The meta line and "Casos
   * anteriores (n)" move into the panel. Absent = the full header (supervision).
   */
  customerFile?: { open: boolean; onToggle(): void }
}

/**
 * Case header (contract §9.3): name; short id (copyable) · "{país} · {ciudad} ·
 * {canal} · {prioridad | en portugués}"; "Datos de ejemplo"; "Casos anteriores
 * (n)" when the customer has other cases; "Cerrar caso" for the assignee, or the
 * "Cerrado" badge on a closed case. The supervisor view adds its "Asignar" /
 * "Reasignar" (`actions`) and never offers "Cerrar caso". The meta line wraps instead of being
 * truncated: "en portugués" is the only cue outside the transcript that the
 * analyst must reply in Portuguese (rule 3).
 */
export function CaseHeader({
  detail,
  onRequestClose,
  onOpenHistory,
  headingRef,
  actions,
  hideClose = false,
  customerFile,
}: CaseHeaderProps) {
  const { case: summary, capabilities } = detail
  const { toast } = useToast()
  const closed = summary.status === 'closed'
  const historyLabel = previousCasesLabel(detail.previousCaseCount)

  function copyId() {
    void navigator.clipboard?.writeText(summary.id).then(
      () => toast({ title: 'Número de caso copiado', description: summary.id, duration: 3000 }),
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
        aria-label="Copiar número de caso"
        icon={<Copy size={13} aria-hidden="true" />}
        onClick={copyId}
      />
    </>
  )

  const rightSide = (
    <div className="flex shrink-0 items-center gap-2">
      {closed ? <Badge tone="closed">Cerrado</Badge> : null}
      {actions}
      <SampleDataTag />
      {historyLabel && onOpenHistory && !customerFile ? (
        <Button
          variant="secondary"
          icon={<History size={15} aria-hidden="true" />}
          onClick={onOpenHistory}
        >
          {historyLabel}
        </Button>
      ) : null}
      {!closed && !hideClose && capabilities.canClose ? (
        <Button variant="secondary" onClick={onRequestClose}>
          Cerrar caso
        </Button>
      ) : null}
    </div>
  )

  if (customerFile) {
    const name = summary.customer.displayName
    return (
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
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
          <p className="m-0 flex shrink-0 items-center gap-x-1 text-13 text-ink-2">{caseNumber}</p>
        </div>
        {rightSide}
      </header>
    )
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 truncate text-17 font-semibold focus-visible:outline-offset-4"
        >
          {summary.customer.displayName}
        </h2>
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-13 text-ink-2">
          {caseNumber}
          <span>· {caseHeaderMeta(detail)}</span>
        </p>
      </div>
      {rightSide}
    </header>
  )
}

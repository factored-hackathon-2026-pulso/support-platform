import type { Ref } from 'react'
import { Copy } from 'lucide-react'
import { topicLabel } from '@/features/cases'
import { Badge, Button, IconButton, SampleDataTag, useToast } from '@/components/ui'
import { caseHeaderMeta, shortCaseId } from '../model'
import type { CaseDetail } from '../types'

export interface CaseHeaderProps {
  detail: CaseDetail
  onRequestClose: () => void
  /** The customer-name heading (focusable with `tabIndex=-1`): the Workspace moves focus here on a programmatic case switch. */
  headingRef?: Ref<HTMLHeadingElement>
}

/**
 * Case header (Workspace.dc.html): name; short id · topic · meta; "Datos de
 * ejemplo"; "Cerrar caso". The meta line wraps like the canvas instead of being
 * truncated: "{país} · {ciudad} · {canal} · en portugués" is the only cue
 * outside the transcript that the analyst must reply in Portuguese (rule 3).
 */
export function CaseHeader({ detail, onRequestClose, headingRef }: CaseHeaderProps) {
  const { case: summary, capabilities } = detail
  const { toast } = useToast()
  const closed = summary.status === 'closed'

  function copyId() {
    void navigator.clipboard?.writeText(summary.id).then(
      () => toast({ title: 'Número de caso copiado', description: summary.id, duration: 3000 }),
      () => undefined,
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
          <span>
            · {topicLabel(summary.topic)} · {caseHeaderMeta(detail)}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {closed ? <Badge tone="neutral">Cerrado</Badge> : null}
        <SampleDataTag />
        {closed ? null : (
          <Button variant="secondary" onClick={onRequestClose} disabled={!capabilities.canClose}>
            Cerrar caso
          </Button>
        )}
      </div>
    </header>
  )
}

import { useId } from 'react'
import {
  Check,
  CircleAlert,
  History,
  Info,
  MessageSquareText,
  Play,
  Puzzle,
  RefreshCcw,
  Sparkles,
} from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  FAILED_SUGGESTION_MESSAGE,
  copilotTurns,
  describeSuggestFailure,
  isAsking,
  suggestionView,
  toolQuestion,
  toolResult,
  type CopilotTurnView,
} from '../model'
import { recordToolUsed } from '../api'
import { useAskCopilot, useCopilotAsks, useCopilotThread } from '../hooks/use-copilot'
import { useLatestSuggestion, useRequestSuggestion } from '../hooks/use-suggestions'
import type { SuggestionAction, SuggestionTool } from '../types'

export interface ToolsPanelProps {
  caseId: string
  /** A closed case: nothing new is asked or suggested. */
  closed: boolean
  /**
   * Whether the Q&A thread is available ("Usar" asks through it, ADR 0005 §3). Without it the
   * tools are listed but cannot be used here.
   */
  canAsk: boolean
  /** "Ir a Copiloto" / "Ver en Copiloto": selects the "Copiloto" tab. */
  onOpenCopilot?(): void
}

/**
 * The "Herramientas" tab (slice 20, IaWorkspace "et2"): the newest suggestion's `tool` items (a
 * read worth looking at; "Usar" asks the copilot a predefined question through her thread and the
 * answer shows on the card) and its `action` items (a write the copilot prepared and does **not**
 * run: information only). "Sugerir" asks for a fresh suggestion; "preparando", "desactualizada"
 * and a failure have their own line. Shown only while the suggestions are `available`.
 */
export function ToolsPanel({ caseId, closed, canAsk, onOpenCopilot }: ToolsPanelProps) {
  const latest = useLatestSuggestion(caseId, true)
  const suggest = useRequestSuggestion(caseId)
  const thread = useCopilotThread(caseId, canAsk)
  const asks = useCopilotAsks(caseId)
  const { ask } = useAskCopilot(caseId)
  const toolsTitle = useId()
  const actionsTitle = useId()

  const view = suggestionView(latest.data)
  const turns = copilotTurns(thread.data?.messages ?? [], asks)
  const asking = isAsking(asks)
  const preparing = suggest.isPending || view?.status === 'preparing'
  const failure = suggest.isError ? describeSuggestFailure(suggest.error) : null
  const tools = view?.tools ?? []
  const actions = view?.actions ?? []
  const empty = tools.length === 0 && actions.length === 0

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 inline-flex items-start gap-2 text-13 text-ink-2">
          <Puzzle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
          Lo que el copiloto propone mirar en este caso.
        </p>
        {closed ? null : (
          <Button
            size="sm"
            variant="secondary"
            icon={<Sparkles size={14} aria-hidden="true" />}
            loading={suggest.isPending}
            aria-disabled={preparing || undefined}
            onClick={() => {
              if (!preparing) suggest.mutate()
            }}
          >
            Sugerir
          </Button>
        )}
      </div>

      {/* Mounted with the tab, so "Preparando" and the failures are announced. */}
      <output className="flex flex-col gap-2 empty:hidden">
        {preparing ? (
          <span className="m-0 inline-flex items-center gap-2 text-13 text-ink-2">
            <Spinner size={14} label={null} />
            Preparando sugerencias: suele tardar unos segundos.
          </span>
        ) : null}
        {!preparing && view?.stale ? (
          <span className="m-0 inline-flex items-start gap-2 text-13 text-ink-2">
            <History size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            El cliente escribió después de esta sugerencia. Pide otra con Sugerir.
          </span>
        ) : null}
        {!preparing && !failure && view?.status === 'failed' ? (
          <span className="m-0 inline-flex items-start gap-2 text-13 text-danger-strong">
            <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {FAILED_SUGGESTION_MESSAGE}
          </span>
        ) : null}
        {failure ? (
          <span className="m-0 inline-flex flex-wrap items-center gap-2 text-13 text-danger-strong">
            <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
            {failure.message}
            {failure.retry ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCcw size={13} aria-hidden="true" />}
                onClick={() => suggest.mutate()}
              >
                Reintentar
              </Button>
            ) : null}
          </span>
        ) : null}
      </output>

      {empty && !preparing ? (
        <div className="flex flex-col items-start gap-2 rounded-12 border border-dashed border-border px-4 py-5">
          <h3 className="m-0 text-15 font-semibold text-ink">
            Todavía no hay herramientas para este caso
          </h3>
          <p className="m-0 text-13 text-ink-2">
            Aparecen cuando el copiloto ve algo que vale la pena consultar. Mientras tanto,
            pregúntale en Copiloto o pídele una sugerencia.
          </p>
          {onOpenCopilot && canAsk ? (
            <Button size="sm" variant="secondary" onClick={onOpenCopilot}>
              Ir a Copiloto
            </Button>
          ) : null}
        </div>
      ) : null}

      {tools.length > 0 ? (
        <section
          aria-labelledby={toolsTitle}
          className={cn('flex flex-col gap-2.5', view?.stale && 'opacity-70')}
        >
          <h3 id={toolsTitle} className="m-0 text-13 font-semibold text-ink">
            Para consultar
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {tools.map((tool) => (
              <ToolCard
                key={`${tool.tool}:${tool.label}`}
                tool={tool}
                result={toolResult(turns, tool)}
                canUse={canAsk && !closed && !asking}
                onUse={() => {
                  ask(toolQuestion(tool))
                  // Slice 21: a stage signal of the case type (best effort, never in the way).
                  if (view?.id) void recordToolUsed(caseId, view.id, tool.tool).catch(() => {})
                }}
                onOpenCopilot={onOpenCopilot}
              />
            ))}
          </ul>
          <p className="m-0 text-12 text-muted">
            Solo consultan: ninguna hace cambios en la cuenta. Cada uso queda en la auditoría.
          </p>
        </section>
      ) : null}

      {actions.length > 0 ? (
        <section
          aria-labelledby={actionsTitle}
          className={cn('flex flex-col gap-2.5', view?.stale && 'opacity-70')}
        >
          <h3 id={actionsTitle} className="m-0 text-13 font-semibold text-ink">
            Preparadas, sin ejecutar
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {actions.map((action) => (
              <ActionCard key={`${action.tool}:${action.summary}`} action={action} />
            ))}
          </ul>
          <p className="m-0 text-12 text-muted">
            El copiloto no las ejecuta. Si corresponde, hazlo tú por el flujo de siempre.
          </p>
        </section>
      ) : null}
    </>
  )
}

interface ToolCardProps {
  tool: SuggestionTool
  /** The newest time she used it (a thread question and its answer). */
  result: CopilotTurnView | null
  canUse: boolean
  onUse(): void
  onOpenCopilot?(): void
}

function ToolCard({ tool, result, canUse, onUse, onOpenCopilot }: ToolCardProps) {
  const used = result?.state === 'answered'
  return (
    <li className="flex flex-col gap-2 rounded-12 border border-border bg-surface px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-14 font-semibold text-ink">{tool.label}</span>
          {tool.why ? <span className="text-13 text-ink-2">{tool.why}</span> : null}
          <span className="truncate font-mono text-11 text-muted" title={tool.tool}>
            {tool.tool}
          </span>
        </div>
        {used ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-12 font-semibold text-success-strong">
            <Check size={13} aria-hidden="true" />
            Consultada
          </span>
        ) : result?.state === 'asking' ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-12 text-ink-2">
            <Spinner size={13} label={null} />
            Consultando
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            icon={<Play size={13} aria-hidden="true" />}
            aria-label={`Usar ${tool.label}`}
            aria-disabled={!canUse || undefined}
            onClick={() => {
              if (canUse) onUse()
            }}
          >
            Usar
          </Button>
        )}
      </div>
      {result?.state === 'failed' ? (
        <p className="m-0 inline-flex items-center gap-1.5 text-12 text-danger-strong">
          <CircleAlert size={13} aria-hidden="true" />
          {result.error ?? 'No se pudo consultar.'} Vuelve a usarla en Copiloto.
        </p>
      ) : null}
      {result?.state === 'unanswered' ? (
        <p className="m-0 text-12 text-muted">El copiloto no devolvió nada con esta herramienta.</p>
      ) : null}
      {used && result ? (
        <div className="flex flex-col gap-1.5 rounded-10 bg-subtle px-3 py-2.5">
          {result.answers.map((answer) => (
            <p key={answer.id} className="m-0 text-13 leading-[1.45] whitespace-pre-wrap text-ink">
              {answer.text}
            </p>
          ))}
          {onOpenCopilot ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              icon={<MessageSquareText size={13} aria-hidden="true" />}
              onClick={onOpenCopilot}
            >
              Ver en Copiloto
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function ActionCard({ action }: { action: SuggestionAction }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-12 border border-dashed border-border bg-subtle px-3.5 py-3">
      <span className="inline-flex items-center gap-1 self-start rounded-full border border-border bg-surface px-[7px] text-11 font-semibold text-ink-2">
        <Info size={12} aria-hidden="true" />
        Solo información
      </span>
      <span className="text-14 text-ink">{action.summary}</span>
      <span className="truncate font-mono text-11 text-muted" title={action.tool}>
        {action.tool}
      </span>
    </li>
  )
}

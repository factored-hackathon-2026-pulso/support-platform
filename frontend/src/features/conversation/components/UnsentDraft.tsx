import { Button, Callout } from '@/components/ui'

export interface UnsentDraftProps {
  text: string
  onDiscard(): void
}

/**
 * What the analyst was writing when she lost the right to reply (supervision
 * reassigned the case, or it closed meanwhile). The composer goes away; the
 * text stays on screen, selectable, until she discards it, so it is never lost
 * silently.
 */
export function UnsentDraft({ text, onDiscard }: UnsentDraftProps) {
  return (
    <div role="note" aria-label="Borrador sin enviar">
      <Callout
        tone="warn"
        title="Tu borrador no se envió"
        actions={
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Descartar borrador
          </Button>
        }
      >
        <p className="m-0">Ya no puedes responder en este caso. Copia el texto si lo necesitas:</p>
        <p className="m-0 mt-1.5 max-h-24 scrollbar-thin overflow-y-auto rounded-8 bg-surface px-2.5 py-2 break-words whitespace-pre-wrap text-ink">
          {text}
        </p>
      </Callout>
    </div>
  )
}

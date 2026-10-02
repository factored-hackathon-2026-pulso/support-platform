import { ArrowRight, Sparkles } from 'lucide-react'
import { Callout, IconButton, Input } from '@/components/ui'

/** Copiloto tab until slice 2: the canvas intro, a "coming next" note and the disabled input. */
export function CopilotPlaceholder() {
  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto px-[18px] py-4">
        <p className="m-0 text-14 leading-[1.45] text-ink-2">
          Pregúntale lo que necesites sobre este cliente. Responde solo con sus datos y te dice de
          dónde salió cada dato.
        </p>
        <Callout tone="neutral" icon={<Sparkles size={16} aria-hidden="true" />} role="note">
          Llega en la próxima entrega. Por ahora atiende el caso desde la conversación.
        </Callout>
      </div>
      <div className="flex gap-2 border-t border-border px-[18px] py-3">
        <Input
          aria-label="Pregúntale al copiloto"
          placeholder="Pregúntale al copiloto"
          disabled
          className="grow"
        />
        <IconButton
          aria-label="Preguntar"
          variant="primary"
          icon={<ArrowRight size={16} strokeWidth={2.2} />}
          disabled
        />
      </div>
    </div>
  )
}

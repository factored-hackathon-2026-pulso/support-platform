import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { activationSteps, type ActivationStep } from '../model'

/** "1 Contraseña — 2 Verificación en dos pasos" (BoActivar `steps`). */
export function StepIndicator({ step }: { step: ActivationStep }) {
  const steps = activationSteps(step)
  return (
    <ol
      aria-label="Pasos para activar tu cuenta"
      className="m-0 flex list-none items-center gap-2.5 p-0"
    >
      {steps.map((item, index) => (
        <li
          key={item.key}
          aria-current={item.status === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2 text-13',
            item.status === 'current' ? 'font-semibold text-ink' : 'text-ink-2',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-[26px] shrink-0 items-center justify-center rounded-full text-12 font-bold',
              item.status === 'done' && 'bg-success text-white',
              item.status === 'current' && 'border-2 border-ink bg-surface text-ink',
              item.status === 'pending' && 'border-[1.5px] border-offline bg-surface text-ink',
            )}
          >
            {item.status === 'done' ? <Check size={14} strokeWidth={3} /> : item.number}
          </span>
          <span>{item.label}</span>
          <span className="sr-only">{item.srState}</span>
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="ml-0.5 h-0.5 w-10 rounded-full bg-offline" />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

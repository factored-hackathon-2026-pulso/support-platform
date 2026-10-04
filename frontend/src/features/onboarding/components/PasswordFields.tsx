import { useId, useState, type Ref } from 'react'
import { Circle, CircleCheck, CircleX } from 'lucide-react'
import { Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { confirmationError, passwordChecks, type PasswordOwner, type RuleState } from '../model'

const RULE_ICON: Record<RuleState, typeof Circle> = {
  ok: CircleCheck,
  bad: CircleX,
  pending: Circle,
}

const RULE_TONE: Record<RuleState, string> = {
  ok: 'text-success-strong',
  bad: 'text-danger-strong',
  pending: 'text-ink-2',
}

const ICON_TONE: Record<RuleState, string> = {
  ok: 'text-success',
  bad: 'text-danger',
  pending: 'text-waiting',
}

export interface PasswordFieldsProps {
  password: string
  confirmation: string
  onPasswordChange(value: string): void
  onConfirmationChange(value: string): void
  owner: PasswordOwner
  /** A server message about the password (policy rejected it). */
  passwordError?: string | null
  /** Show the mismatch error even before blur (after a failed submit). */
  passwordLabel?: string
  passwordRef?: Ref<HTMLInputElement>
  confirmationRef?: Ref<HTMLInputElement>
}

/**
 * "Contraseña nueva" + live requirements + "Repite la contraseña" (BoActivar step 1,
 * shared with the reset link). The rules list describes the password input; each rule
 * says ": cumple" / ": no cumple" / ": pendiente" to screen readers.
 */
export function PasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  owner,
  passwordError = null,
  passwordLabel = 'Contraseña nueva',
  passwordRef,
  confirmationRef,
}: PasswordFieldsProps) {
  const [show, setShow] = useState(false)
  const id = useId()
  const passwordId = `${id}-password`
  const rulesId = `${id}-rules`
  const checks = passwordChecks(password, confirmation, owner)
  const mismatch = confirmationError(password, confirmation)
  const type = show ? 'text' : 'password'

  return (
    <>
      <Field
        id={passwordId}
        label={passwordLabel}
        error={passwordError}
        labelAside={
          <button
            type="button"
            aria-pressed={show}
            className="cursor-pointer text-14 text-link font-semibold"
            onClick={() => setShow((value) => !value)}
          >
            {show ? 'Ocultar' : 'Mostrar'}
          </button>
        }
      >
        <Input
          ref={passwordRef}
          type={type}
          size="lg"
          autoComplete="new-password"
          value={password}
          aria-describedby={[passwordError ? `${passwordId}-error` : null, rulesId]
            .filter(Boolean)
            .join(' ')}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Field>
      <ul
        id={rulesId}
        aria-label="Requisitos de la contraseña"
        className="m-0 flex list-none flex-col gap-1.5 rounded-10 bg-panel px-3.5 py-3 text-13"
      >
        {checks.map((check) => {
          const Icon = RULE_ICON[check.state]
          return (
            <li key={check.key} className={cn('flex items-center gap-2', RULE_TONE[check.state])}>
              <Icon
                size={16}
                strokeWidth={check.state === 'pending' ? 2 : 2.4}
                aria-hidden="true"
                className={cn('shrink-0', ICON_TONE[check.state])}
              />
              <span>{check.label}</span>
              <span className="sr-only">{check.srState}</span>
            </li>
          )
        })}
      </ul>
      <Field label="Repite la contraseña" error={mismatch}>
        <Input
          ref={confirmationRef}
          type={type}
          size="lg"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </Field>
    </>
  )
}

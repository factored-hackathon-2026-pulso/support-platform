import { Link2Off, Mail } from 'lucide-react'
import { Link } from 'react-router'
import { DocumentTitle } from '@/components/ui'
import { INVALID_LINK_COPY, type LinkKind } from '../model'

/**
 * "El enlace venció o ya se usó" (BoActivar `vencido`): one screen for an unknown,
 * expired, used or cancelled link (the server never says which).
 */
export function LinkInvalid({ kind }: { kind: LinkKind }) {
  const copy = INVALID_LINK_COPY[kind]
  return (
    <>
      <DocumentTitle title="El enlace venció o ya se usó" />
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-16 bg-warn-soft text-warn-strong"
      >
        <Link2Off size={28} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-30 font-bold text-balance">
          El enlace venció o ya se usó
        </h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">{copy.text}</p>
      </div>
      <div className="flex gap-2.5 rounded-12 bg-panel px-4 py-3.5 text-14 leading-[1.5] text-ink-2">
        <Mail size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink">{copy.askTitle}</span>
          <span>{copy.askText}</span>
        </span>
      </div>
      <p className="m-0 text-14 text-ink-2">
        {kind === 'invitation' ? '¿Ya activaste tu cuenta? ' : '¿Ya tienes tu contraseña? '}
        <Link to="/login" className="text-link font-semibold">
          Entra con tu correo
        </Link>
      </p>
    </>
  )
}

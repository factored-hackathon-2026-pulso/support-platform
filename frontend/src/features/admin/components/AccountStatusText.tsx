import { Lock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ACCOUNT_STATUS_LABEL, accountStatusAt, lockedUntilTitle } from '../model'
import type { AdminUser } from '../types'

export interface AccountStatusTextProps {
  user: Pick<AdminUser, 'status' | 'lockedUntil'>
  now: number
  className?: string
}

/**
 * "Cuenta" (contract §10.2): "Activa" ink-2, "Bloqueada" warn with a lock and
 * its end time, "Desactivada" muted. Recomputed with the ticking clock: an
 * expired lock reads "Activa".
 */
export function AccountStatusText({ user, now, className }: AccountStatusTextProps) {
  const status = accountStatusAt(user, now)
  if (status === 'locked' && user.lockedUntil) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-13 font-semibold text-warn', className)}
        title={lockedUntilTitle(user.lockedUntil)}
      >
        <Lock size={13} aria-hidden="true" />
        {ACCOUNT_STATUS_LABEL.locked}
      </span>
    )
  }
  return (
    <span className={cn('text-13', status === 'inactive' ? 'text-muted' : 'text-ink-2', className)}>
      {ACCOUNT_STATUS_LABEL[status]}
    </span>
  )
}

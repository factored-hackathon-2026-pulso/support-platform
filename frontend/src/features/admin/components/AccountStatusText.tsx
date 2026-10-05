import { Status } from '@/components/ui'
import { useActiveLocale } from '@/lib/i18n'
import { ACCOUNT_STATUS, accountStatusAt, lockedUntilTitle } from '../model'
import type { AdminUser } from '../types'

export interface AccountStatusTextProps {
  user: Pick<AdminUser, 'status' | 'lockedUntil'>
  now: number
  className?: string
}

/**
 * "Cuenta" (contract §10.2) as glyph + word (`ACCOUNT_STATUS`): "Activa",
 * "Bloqueada" (its end time on hover), "Desactivada". Recomputed with the
 * ticking clock: an expired lock reads "Activa".
 */
export function AccountStatusText({ user, now, className }: AccountStatusTextProps) {
  useActiveLocale()
  const status = accountStatusAt(user, now)
  return (
    <Status
      {...ACCOUNT_STATUS[status]}
      title={
        status === 'locked' && user.lockedUntil ? lockedUntilTitle(user.lockedUntil) : undefined
      }
      className={className}
    />
  )
}

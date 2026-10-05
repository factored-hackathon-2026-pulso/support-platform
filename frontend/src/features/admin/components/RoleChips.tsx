import { ROLE_LABEL, sortRoles, type RoleId } from '@/app/roles'
import { cn } from '@/lib/cn'
import { useActiveLocale } from '@/lib/i18n'

/** Canvas role chips (Admin.dc.html): Analista grey, Supervisión peach, Administración green. */
const CHIP_CLASS: Record<RoleId, string> = {
  analyst: 'bg-panel text-ink-2',
  supervisor: 'bg-peach text-warn-strong',
  admin: 'bg-success-tint text-success-ink',
}

export interface RoleChipsProps {
  roles: readonly string[]
  className?: string
}

/** The person's roles in canonical order, as small pills. */
export function RoleChips({ roles, className }: RoleChipsProps) {
  useActiveLocale()
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {sortRoles(roles).map((role) => (
        <span
          key={role}
          className={cn(
            'rounded-full px-[7px] py-px text-11 font-semibold whitespace-nowrap',
            CHIP_CLASS[role],
          )}
        >
          {ROLE_LABEL[role]}
        </span>
      ))}
    </span>
  )
}

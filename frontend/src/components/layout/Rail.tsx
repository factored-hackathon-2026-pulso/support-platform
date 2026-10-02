import { Link, useLocation } from 'react-router'
import {
  isNavItemActive,
  type NavItem,
  type RailIndicator,
  type RailIndicators,
  type RoleDefinition,
} from '@/app/roles'
import { CountBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { RoleSwitcher } from './RoleSwitcher'

export interface RailProps {
  role: RoleDefinition
  /** Live badge / dot values by indicator key (app/rail-indicators.ts). Missing → nothing shown. */
  indicators?: RailIndicators
}

/** The count and dot of an item, or nothing when its indicator has no value. */
function indicatorFor(item: NavItem, indicators: RailIndicators): RailIndicator {
  return (item.indicator && indicators[item.indicator]) || {}
}

function navAccessibleName(label: string, { count, dot }: RailIndicator): string {
  if (count) return `${label}, ${count} ${count === 1 ? 'pendiente' : 'pendientes'}`
  if (dot) return `${label}, con novedades`
  return label
}

/** Dark 64px left rail: brand mark, the current role's destinations and the role switcher. */
export function Rail({ role, indicators = {} }: RailProps) {
  const { pathname } = useLocation()
  return (
    <nav
      aria-label="Principal"
      data-surface="dark"
      className="flex w-16 shrink-0 flex-col items-center gap-2 bg-rail py-4"
    >
      <span
        aria-hidden="true"
        className="mb-3 font-display text-15 font-bold text-white"
        title="Plataforma CC"
      >
        CC
      </span>
      <ul className="m-0 flex list-none flex-col items-center gap-2 p-0">
        {role.nav.map((item) => {
          const Icon = item.icon
          const active = isNavItemActive(item, pathname)
          const { count, dot } = indicatorFor(item, indicators)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-label={navAccessibleName(item.label, { count, dot })}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                className={cn(
                  'relative flex size-11 items-center justify-center rounded-10 transition-colors focus-visible:outline-white',
                  active
                    ? 'bg-rail-active text-white'
                    : 'text-rail-icon hover:bg-rail-active/60 hover:text-white',
                )}
              >
                <Icon size={20} aria-hidden="true" />
                {count ? <CountBadge count={count} className="absolute top-0.5 right-0" /> : null}
                {!count && dot ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-[7px] right-[7px] size-2 rounded-full bg-badge"
                  />
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
      <RoleSwitcher currentRole={role} />
    </nav>
  )
}

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import {
  isNavItemActive,
  type NavItem,
  type RailIndicator,
  type RailIndicators,
  type RailPresence,
  type RoleDefinition,
} from '@/app/roles'
import { CountBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { i18n, useTranslation } from '@/lib/i18n'
import { RoleSwitcher } from './RoleSwitcher'

export interface RailProps {
  role: RoleDefinition
  /** Live badge / dot values by indicator key (app/rail-indicators.ts). Missing → nothing shown. */
  indicators?: RailIndicators
  /** Presence dot on the avatar (the analyst's availability); null/absent = none. */
  presence?: RailPresence | null
  /**
   * Slot above the avatar for every role: the notification bell (slice 10). The rail never
   * imports a feature; the route table composes it (app/router.tsx).
   */
  notifications?: ReactNode
}

/** The count and dot of an item, or nothing when its indicator has no value. */
function indicatorFor(item: NavItem, indicators: RailIndicators): RailIndicator {
  return (item.indicator && indicators[item.indicator]) || {}
}

/** "Casos, 2 pendientes", "Colas, 3 sin asignar", "Inicio, con novedades". */
function navAccessibleName(label: string, { count, dot, noun = 'pending' }: RailIndicator): string {
  if (count) return i18n.t(`shell:rail.${noun}`, { label, count })
  if (dot) return i18n.t('shell:rail.withNews', { label })
  return label
}

/**
 * Dark 64px left rail: brand mark, the current role's destinations and, at the bottom, the
 * notification bell above the role switcher.
 */
export function Rail({ role, indicators = {}, presence = null, notifications }: RailProps) {
  const { pathname } = useLocation()
  const { t } = useTranslation(['shell', 'common'])
  return (
    <nav
      aria-label={t('rail.label')}
      data-surface="dark"
      className="flex w-16 shrink-0 flex-col items-center gap-2 bg-rail py-4"
    >
      <span
        aria-hidden="true"
        className="mb-3 font-display text-15 font-bold text-white"
        title={t('common:brand.name')}
      >
        {t('common:brand.mark')}
      </span>
      <ul className="m-0 flex list-none flex-col items-center gap-2 p-0">
        {role.nav.map((item) => {
          const Icon = item.icon
          const active = isNavItemActive(item, pathname)
          const { count, dot, noun } = indicatorFor(item, indicators)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-label={navAccessibleName(item.label, { count, dot, noun })}
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
      <div className="mt-auto flex flex-col items-center gap-2">
        {notifications}
        <RoleSwitcher currentRole={role} presence={presence} />
      </div>
    </nav>
  )
}

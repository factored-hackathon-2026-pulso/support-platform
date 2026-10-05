import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Check, Globe, LogOut } from 'lucide-react'
import { useSetUiLanguage } from '@/app/preferences'
import { ROLES, type RailPresence, type RoleDefinition } from '@/app/roles'
import { useCurrentUser, useSession } from '@/app/session'
import { Avatar, Fact, Kicker } from '@/components/ui'
import { cn } from '@/lib/cn'
import { APP_LOCALES, LOCALE_NAME, useActiveLocale, useTranslation } from '@/lib/i18n'

export interface RoleSwitcherProps {
  currentRole: RoleDefinition
  /** Presence dot over the avatar (slice 6: the analyst's availability). */
  presence?: RailPresence | null
}

const itemClass = 'flex min-h-10 w-full items-center rounded-8 px-2.5 text-14 text-ink'

/**
 * Avatar button at the bottom of the rail. Opens a popover with the user, the language of
 * the platform (slice 23: each by its own name, saved on her profile), the
 * CAMBIAR DE ROL list (only the roles the user holds, current one marked) and
 * sign out. Disclosure pattern: button[aria-expanded] + panel; Escape, an
 * outside click and tabbing out close it. 220px wide like the role boards
 * (Admin.dc.html draws it at 240px).
 */
export function RoleSwitcher({ currentRole, presence = null }: RoleSwitcherProps) {
  const user = useCurrentUser()
  const { signOut } = useSession()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const labelId = `${panelId}-label`
  const languageId = `${panelId}-language`
  const { t } = useTranslation(['shell', 'common'])
  const locale = useActiveLocale()
  const { setUiLanguage } = useSetUiLanguage()

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Only pull focus back when it is still inside the switcher.
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        // Tabbing out of the panel closes it (it would otherwise cover the page).
        const next = event.relatedTarget
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('accountMenu.open', { name: user.name })}
        title={`${user.name} (${user.id})`}
        onClick={() => setOpen((value) => !value)}
        className="cursor-pointer rounded-full focus-visible:outline-white"
      >
        <Avatar
          name={user.name}
          initials={user.initials}
          tone={currentRole.avatarTone}
          decorative
        />
      </button>
      {presence ? (
        <>
          <span
            aria-hidden="true"
            title={presence.label}
            className={cn(
              'pointer-events-none absolute right-0 bottom-0 size-3 rounded-full border-2 border-rail',
              presence.tone === 'warn' ? 'bg-badge' : 'bg-success',
            )}
          />
          <span className="sr-only">{presence.label}</span>
        </>
      ) : null}

      {open ? (
        <div
          id={panelId}
          data-surface="light"
          className={cn(
            'absolute bottom-0 left-[52px] z-30 flex flex-col',
            currentRole.id === 'admin' ? 'w-[240px]' : 'w-[220px]',
            'gap-0.5 rounded-10 border border-border bg-surface p-1.5 shadow-popover',
          )}
        >
          <span className="px-2.5 pt-2 text-14 font-semibold">{user.name}</span>
          {user.summary.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 px-2.5 pb-1.5">
              {user.summary.map(({ key, ...fact }) => (
                <li key={key} className="flex">
                  <Fact {...fact} />
                </li>
              ))}
            </ul>
          ) : null}
          <Kicker
            size="sm"
            id={languageId}
            className="flex items-center gap-1.5 border-t border-border-soft px-2.5 pt-1.5 pb-0.5"
          >
            <Globe size={12} aria-hidden="true" />
            {t('accountMenu.language')}
          </Kicker>
          <ul aria-labelledby={languageId} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {APP_LOCALES.map((option) => {
              const current = option === locale
              return (
                <li key={option}>
                  <button
                    type="button"
                    lang={option}
                    aria-pressed={current}
                    onClick={() => {
                      if (!current) setUiLanguage(option)
                    }}
                    className={cn(
                      itemClass,
                      'cursor-pointer justify-between',
                      current ? 'bg-canvas font-semibold' : 'hover:bg-subtle',
                    )}
                  >
                    {LOCALE_NAME[option]}
                    {current ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
          <Kicker
            size="sm"
            id={labelId}
            className="border-t border-border-soft px-2.5 pt-1.5 pb-0.5"
          >
            {t('accountMenu.switchRole')}
          </Kicker>
          <ul aria-labelledby={labelId} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {user.roleIds.map((id) => {
              const role = ROLES[id]
              const current = id === currentRole.id
              return (
                <li key={id}>
                  <Link
                    to={role.home}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      itemClass,
                      current ? 'bg-canvas font-semibold' : 'hover:bg-subtle',
                    )}
                  >
                    {role.label}
                  </Link>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              signOut()
            }}
            className={cn(
              itemClass,
              'mt-0.5 cursor-pointer gap-2 border-t border-border-soft text-ink-2 hover:bg-subtle',
            )}
          >
            <LogOut size={16} aria-hidden="true" />
            {t('common:actions.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

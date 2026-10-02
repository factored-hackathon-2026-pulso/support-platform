import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { LogOut } from 'lucide-react'
import { ROLES, type RoleDefinition } from '@/app/roles'
import { useCurrentUser, useSession } from '@/app/session'
import { Avatar, Kicker } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface RoleSwitcherProps {
  currentRole: RoleDefinition
}

const itemClass = 'flex min-h-10 w-full items-center rounded-8 px-2.5 text-14 text-ink'

/**
 * Avatar button at the bottom of the rail. Opens a popover with the user, the
 * CAMBIAR DE ROL list (only the roles the user holds, current one marked) and
 * sign out. Disclosure pattern: button[aria-expanded] + panel; Escape, an
 * outside click and tabbing out close it. 220px wide like the role boards
 * (Admin.dc.html draws it at 240px).
 */
export function RoleSwitcher({ currentRole }: RoleSwitcherProps) {
  const user = useCurrentUser()
  const { signOut } = useSession()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const labelId = `${panelId}-label`

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
      className="relative mt-auto"
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
        aria-label={`${user.name}, cambiar de rol`}
        title={[user.name, user.id, user.summary].filter(Boolean).join(' · ')}
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
          {user.summary ? (
            <span className="px-2.5 pb-1.5 text-12 text-ink-2">{user.summary}</span>
          ) : null}
          <Kicker
            size="sm"
            id={labelId}
            className="border-t border-border-soft px-2.5 pt-1.5 pb-0.5"
          >
            Cambiar de rol
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
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  )
}

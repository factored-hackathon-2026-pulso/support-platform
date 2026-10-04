import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ChoiceMenuOption<T extends string> {
  value: T
  /** The visible word of the option ("Alta"). */
  label: string
  /** A decorative glyph before the label. */
  icon?: ReactNode
}

export interface ChoiceMenuProps<T extends string> {
  /** The checked option. */
  value: T
  options: readonly ChoiceMenuOption<T>[]
  /** A different option was picked (the menu closes and the focus returns to the trigger). */
  onChange(value: T): void
  /** What the trigger shows (usually the checked option's glyph and word). */
  children: ReactNode
  /** The trigger's accessible name: the current value and the action ("Prioridad: Alta. Cambiar"). */
  triggerLabel: string
  /** The menu's accessible name ("Prioridad"). */
  menuLabel: string
  disabled?: boolean
  /** Which trigger edge the menu lines up with (default `start`). */
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
}

/**
 * A menu button with one checked choice (WAI-ARIA menu button + `menuitemradio`), for a
 * small fixed set such as a priority. Click, Enter or Space opens it on the checked option;
 * ArrowDown / ArrowUp open it on the first / last one. Inside: arrows move (wrapping), Home
 * and End jump, a letter jumps to the next option starting with it, Enter or Space picks,
 * Escape closes; both return the focus to the trigger. Tab or a click outside closes it.
 */
export function ChoiceMenu<T extends string>({
  value,
  options,
  onChange,
  children,
  triggerLabel,
  menuLabel,
  disabled = false,
  align = 'start',
  className,
  triggerClassName,
}: ChoiceMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus()
  }, [open, active])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function openAt(index: number) {
    setActive(index)
    setOpen(true)
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  function pick(option: ChoiceMenuOption<T>) {
    close({ restoreFocus: true })
    if (option.value !== value) onChange(option.value)
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openAt(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAt(options.length - 1)
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => (index >= last ? 0 : index + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => (index <= 0 ? last : index - 1))
        return
      case 'Home':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
        event.preventDefault()
        setActive(last)
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation() // a panel or dialog around it stays open
        close({ restoreFocus: true })
        return
      case 'Tab':
        setOpen(false)
        return
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLocaleLowerCase('es')
      const order = options.map((_, offset) => (active + 1 + offset) % options.length)
      const next = order.find((index) =>
        options[index]?.label.toLocaleLowerCase('es').startsWith(letter),
      )
      if (next !== undefined) setActive(next)
    }
  }

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => (open ? close({ restoreFocus: false }) : openAt(checkedIndex))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-8 px-1.5 py-0.5 text-ink hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent',
          triggerClassName,
        )}
      >
        {children}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={menuLabel}
          data-surface="light"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-30 mt-1 flex min-w-[184px] flex-col gap-0.5 rounded-10 border border-border bg-surface p-1 shadow-popover',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((option, index) => {
            const checked = option.value === value
            return (
              <button
                key={option.value}
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={index === active ? 0 : -1}
                onClick={() => pick(option)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    pick(option)
                  }
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-8 px-2 text-left text-14 text-ink outline-offset-[-2px] hover:bg-subtle focus-visible:bg-subtle',
                  checked && 'font-medium',
                )}
              >
                {option.icon}
                <span className="grow">{option.label}</span>
                {checked ? (
                  <Check size={14} aria-hidden="true" className="shrink-0 text-ink-2" />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

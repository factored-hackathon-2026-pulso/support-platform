import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  countSelected,
  type ActiveFilterChip,
  type FilterGroup,
  type FilterSelection,
} from './filter-selection'
import { LanguageMark } from './LanguageMark'

export interface FilterMenuProps {
  groups: readonly FilterGroup[]
  selection: FilterSelection
  /** One option toggled on or off. */
  onToggle(groupKey: string, value: string): void
  /** "Limpiar filtros": every group back to nothing checked. */
  onClear(): void
  /** Which side the panel opens to. */
  align?: 'start' | 'end'
  className?: string
}

/**
 * The one way to filter a list (Linear-style, slice 9): a "Filtros" button that
 * opens a panel of checkbox groups (each option with its count), "Limpiar
 * filtros" and "Listo". The active options show as removable chips next to it
 * (`FilterChips`). Never a row of pills or tabs. A disclosure, not a menu: the
 * panel holds native checkboxes (Tab moves through them); Escape or a click
 * outside closes it, and Escape puts the focus back on the button.
 */
export function FilterMenu({
  groups,
  selection,
  onToggle,
  onClear,
  align = 'start',
  className,
}: FilterMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLFieldSetElement>(null)
  const panelId = useId()
  const active = countSelected(selection)

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !rootRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation() // a sheet or dialog around it stays open
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    // Capture: runs before a dialog's own Escape handler on the document.
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-9 cursor-pointer items-center gap-2 rounded-10 border bg-surface px-3 text-14 font-medium text-ink hover:bg-subtle',
          open || active > 0 ? 'border-ink' : 'border-border',
        )}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        Filtros
        {active > 0 ? ' ' : null}
        {active > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-12 font-semibold text-white">
            {active} <span className="sr-only">activos</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <fieldset
          ref={panelRef}
          id={panelId}
          data-surface="light"
          className={cn(
            'absolute top-full z-30 m-0 mt-1.5 flex w-max max-w-[560px] min-w-[260px] flex-col rounded-12 border border-border bg-surface p-0 shadow-popover',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <legend className="sr-only">Filtros</legend>
          <div className="flex max-h-[360px] flex-wrap gap-x-6 gap-y-3 overflow-y-auto p-4">
            {groups.map((group) => (
              <fieldset
                key={group.key}
                className="m-0 flex min-w-[150px] flex-col gap-1.5 border-0 p-0"
              >
                <legend className="mb-1 p-0 text-12 font-semibold tracking-kicker text-muted uppercase">
                  {group.legend}
                </legend>
                {group.options.map((option) => {
                  const checked = selection[group.key]?.includes(option.value) ?? false
                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded-8 py-0.5 text-14 text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(group.key, option.value)}
                        className="size-4 shrink-0 accent-ink"
                      />
                      <span className="grow" lang={option.language}>
                        {option.label}
                      </span>
                      {option.count !== undefined ? ' ' : null}
                      {option.count !== undefined ? (
                        <span className="text-13 text-muted tabular-nums">{option.count}</span>
                      ) : null}
                    </label>
                  )
                })}
              </fieldset>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border-soft px-4 py-2.5">
            <button
              type="button"
              // aria-disabled keeps the focus here after clearing (Escape still closes).
              aria-disabled={active === 0}
              onClick={() => {
                if (active > 0) onClear()
              }}
              className="cursor-pointer rounded-8 px-1 text-13 font-medium text-ink-2 hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-50"
            >
              Limpiar filtros
            </button>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-8 cursor-pointer items-center rounded-8 bg-ink px-3 text-13 font-semibold text-white"
            >
              Listo
            </button>
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}

export interface FilterChipsProps {
  chips: readonly ActiveFilterChip[]
  onRemove(groupKey: string, value: string): void
  /** A trailing "Limpiar filtros" (when there are chips). */
  onClear?(): void
  className?: string
}

/** The active filters as removable chips ("Quitar filtro Por responder"). Nothing when none. */
export function FilterChips({ chips, onRemove, onClear, className }: FilterChipsProps) {
  if (chips.length === 0) return null
  return (
    <fieldset className={cn('m-0 flex flex-wrap items-center gap-1.5 border-0 p-0', className)}>
      <legend className="sr-only">Filtros activos</legend>
      {chips.map((chip) => (
        <button
          key={`${chip.groupKey}:${chip.value}`}
          type="button"
          aria-label={`Quitar filtro ${chip.label}`}
          onClick={() => onRemove(chip.groupKey, chip.value)}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface pr-2 pl-3 text-13 text-ink hover:bg-subtle"
        >
          {chip.language ? <LanguageMark languages={[chip.language]} /> : chip.label}
          <X size={13} aria-hidden="true" className="text-muted" />
        </button>
      ))}
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer rounded-8 px-1.5 text-13 font-medium text-ink-2 hover:text-ink"
        >
          Limpiar filtros
        </button>
      ) : null}
    </fieldset>
  )
}

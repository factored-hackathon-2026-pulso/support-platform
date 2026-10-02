export type ControlSize = 'sm' | 'md' | 'lg'

/** Shared look for text inputs and selects (border #dedbd2, radius 10). */
export const controlBase =
  'w-full rounded-10 border border-border bg-surface text-ink placeholder:text-muted transition-colors outline-none focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-border disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-invalid:border-2 aria-invalid:border-danger'

export const controlSizes: Record<ControlSize, string> = {
  sm: 'min-h-[34px] rounded-8 px-2.5 text-14',
  md: 'min-h-10 px-3 text-14',
  lg: 'min-h-12 px-3.5 text-15',
}

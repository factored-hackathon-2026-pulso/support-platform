import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-rail-active',
  accent: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'border border-border bg-surface text-ink hover:bg-subtle',
  ghost: 'bg-transparent text-ink-2 hover:bg-panel hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger-strong',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-[34px] rounded-8 px-3 text-13',
  md: 'min-h-10 rounded-10 px-3.5 text-14',
  lg: 'min-h-12 rounded-10 px-5 text-15',
}

export interface ButtonStyleProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretch to the container width. */
  block?: boolean
}

/** Class names for anything that should look like a button (button, Link, a). */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  block = false,
}: ButtonStyleProps = {}): string {
  return cn(base, variants[variant], sizes[size], block && 'w-full')
}

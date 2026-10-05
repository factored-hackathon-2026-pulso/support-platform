import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'

export type IconButtonVariant = 'secondary' | 'ghost' | 'primary' | 'soft'
export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: icon-only buttons must have an accessible name. */
  'aria-label': string
  /** The icon element (lucide, size 16–18). */
  icon: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Small orange dot in the corner; adds " con alertas" to the accessible name. */
  dot?: boolean
  ref?: Ref<HTMLButtonElement>
}

const variants: Record<IconButtonVariant, string> = {
  secondary: 'border border-border bg-surface text-ink hover:bg-subtle',
  ghost: 'bg-transparent text-ink hover:bg-panel',
  primary: 'bg-ink text-white hover:bg-rail-active',
  soft: 'bg-canvas text-ink hover:bg-panel',
}

const sizes: Record<IconButtonSize, string> = {
  sm: 'size-8 rounded-8',
  md: 'size-10 rounded-10',
}

/** Square icon-only button. `title` defaults to the aria-label (native tooltip). */
export function IconButton({
  icon,
  variant = 'secondary',
  size = 'md',
  dot = false,
  className,
  type = 'button',
  title,
  'aria-label': label,
  ...props
}: IconButtonProps) {
  const { t } = useTranslation()
  return (
    <button
      type={type}
      // aria-label replaces the content, so the alert state goes into the name itself.
      aria-label={dot ? t('withAlerts', { name: label }) : label}
      title={title ?? label}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
      {dot ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-warn"
        />
      ) : null}
    </button>
  )
}

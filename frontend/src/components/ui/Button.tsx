import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/lib/cn'
import { buttonClasses, type ButtonStyleProps } from './button-styles'
import { Spinner } from './Spinner'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean
  /** Icon rendered before the label (lucide icon element, size 16). */
  icon?: ReactNode
  /** Icon rendered after the label. */
  iconEnd?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * Action button. Variants: primary (ink), accent (blue), secondary (white + border),
 * ghost, danger. Sizes: sm (34px), md (40px), lg (48px).
 * For navigation use `LinkButton` (renders a react-router Link with the same look).
 */
export function Button({
  variant,
  size,
  block,
  loading = false,
  icon,
  iconEnd,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses({ variant, size, block }), className)}
      {...props}
    >
      {loading ? <Spinner label={null} size={16} /> : icon}
      {children}
      {iconEnd}
    </button>
  )
}

export interface LinkButtonProps extends LinkProps, ButtonStyleProps {
  icon?: ReactNode
  iconEnd?: ReactNode
  ref?: Ref<HTMLAnchorElement>
}

/** A react-router `Link` styled as a Button. */
export function LinkButton({
  variant,
  size,
  block,
  icon,
  iconEnd,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={cn(buttonClasses({ variant, size, block }), className)} {...props}>
      {icon}
      {children}
      {iconEnd}
    </Link>
  )
}

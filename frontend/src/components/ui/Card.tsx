import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/lib/cn'
import { cardClasses, type CardStyleProps } from './card-styles'

export interface CardProps
  extends HTMLAttributes<HTMLElement>, Omit<CardStyleProps, 'interactive'> {
  /** Container element. For a clickable card use LinkCard (or a button with cardClasses). */
  as?: 'div' | 'section' | 'article' | 'li'
}

/** White bordered container (radius 12 by default). */
export function Card({
  as: Component = 'div',
  padding,
  tone,
  radius,
  className,
  ...props
}: CardProps) {
  return <Component className={cn(cardClasses({ padding, tone, radius }), className)} {...props} />
}

export interface LinkCardProps extends LinkProps, Omit<CardStyleProps, 'interactive'> {
  ref?: Ref<HTMLAnchorElement>
}

/** A whole card that navigates (react-router Link with the Card look + hover). */
export function LinkCard({ padding, tone, radius, className, ...props }: LinkCardProps) {
  return (
    <Link
      className={cn(cardClasses({ padding, tone, radius, interactive: true }), className)}
      {...props}
    />
  )
}

export interface CardHeaderProps {
  title: ReactNode
  /** Heading level for the title (default h2). */
  as?: 'h2' | 'h3' | 'h4'
  /** Right side: a count ("3 temas"), a link or actions. */
  aside?: ReactNode
  className?: string
}

/** Title row inside a Card: 16px semibold title + muted aside. */
export function CardHeader({ title, as: Heading = 'h2', aside, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <Heading className="m-0 text-16 font-semibold">{title}</Heading>
      {aside ? <div className="shrink-0 text-13 text-muted">{aside}</div> : null}
    </div>
  )
}

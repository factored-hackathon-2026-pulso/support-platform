import type { HTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { controlBase } from './control-styles'
import { useFieldControl } from './field-context'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * bordered: standalone field (default).
   * bare: no border/padding, for composers. Put it inside a <ComposerFrame>,
   * which draws the focus ring; on its own it keeps the default focus outline.
   */
  variant?: 'bordered' | 'bare'
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ variant = 'bordered', rows = 3, className, ...props }: TextareaProps) {
  const fieldProps = useFieldControl(props)
  return (
    <textarea
      rows={rows}
      className={cn(
        variant === 'bordered'
          ? cn(controlBase, 'resize-none px-3 py-2.5 text-14 leading-[1.45]')
          : 'w-full resize-none border-0 bg-transparent p-0 text-15 leading-[1.45] text-ink placeholder:text-muted [[data-composer-frame]_&]:outline-none',
        className,
      )}
      {...fieldProps}
    />
  )
}

export type ComposerFrameProps = HTMLAttributes<HTMLDivElement>

/**
 * Bordered box around a bare Textarea and its toolbar (chat composer). Shows the
 * control focus ring while the textarea inside has keyboard focus.
 */
export function ComposerFrame({ className, ...props }: ComposerFrameProps) {
  return (
    <div
      data-composer-frame
      className={cn(
        'rounded-10 border border-border bg-surface transition-colors has-[textarea:focus-visible]:border-accent has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent-border',
        className,
      )}
      {...props}
    />
  )
}

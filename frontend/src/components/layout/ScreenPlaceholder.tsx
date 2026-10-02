import type { ReactNode } from 'react'
import { Construction } from 'lucide-react'
import { EmptyState, PageHeader } from '@/components/ui'
import { Page, PageBody } from './Page'

export interface ScreenPlaceholderProps {
  /** Page title (h1), as in the canvas board. */
  title: string
  subtitle?: ReactNode
  /** What the screen will do, in one sentence. */
  description?: ReactNode
  /** Extra line under the description (e.g. the selected id from the URL). */
  detail?: ReactNode
  /** Element before the title (back link). */
  eyebrow?: ReactNode
}

/**
 * Designed placeholder for screens that arrive in a later slice: real header
 * (title + subtitle from the canvas) and an EmptyState body. Keeps navigation,
 * guards and URLs testable before the screen exists.
 */
export function ScreenPlaceholder({
  title,
  subtitle,
  description,
  detail,
  eyebrow,
}: ScreenPlaceholderProps) {
  return (
    <Page header={<PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} />}>
      <PageBody className="flex items-center justify-center">
        <EmptyState
          icon={<Construction size={40} strokeWidth={1.6} />}
          title="En construcción"
          description={
            <>
              {description ?? 'Esta pantalla ya está diseñada y llega en una próxima entrega.'}
              {detail ? <span className="mt-2 block text-13 text-muted">{detail}</span> : null}
            </>
          }
        />
      </PageBody>
    </Page>
  )
}

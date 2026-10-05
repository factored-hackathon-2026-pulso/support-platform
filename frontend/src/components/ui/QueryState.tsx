import type { ReactNode } from 'react'
import { Button } from './Button'
import { Callout } from './Callout'
import { useTranslation } from '@/lib/i18n'

/** The part of a TanStack Query result QueryState needs (structural, no import). */
export interface QueryLike<T> {
  status: 'pending' | 'error' | 'success'
  data: T | undefined
  isFetching?: boolean
  refetch: () => unknown
}

export interface QueryStateProps<T> {
  query: QueryLike<T>
  /** Loading placeholder shaped like the content (Skeletons). */
  skeleton: ReactNode
  /** Shown instead of `children` when `isEmpty(data)` (usually an EmptyState). */
  empty?: ReactNode
  /** Default: empty arrays count as empty. */
  isEmpty?: (data: T) => boolean
  /** Error title. Default "No pudimos cargar esta información". */
  errorTitle?: ReactNode
  /** Error text (map ApiProblem codes to copy in the feature model). */
  errorDescription?: ReactNode
  children: (data: T) => ReactNode
}

const defaultIsEmpty = (data: unknown) => Array.isArray(data) && data.length === 0

/**
 * The three designed states of every query in one place: skeleton while
 * loading, a danger Callout with "Reintentar" on error, `empty` when there is
 * nothing to show, otherwise `children(data)`.
 *
 * @example
 * <QueryState query={queuesQuery} skeleton={<QueueSkeleton />} empty={<EmptyState … />}>
 *   {(queues) => <QueueTable queues={queues} />}
 * </QueryState>
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty = defaultIsEmpty,
  errorTitle,
  errorDescription,
  children,
}: QueryStateProps<T>) {
  const { t } = useTranslation()
  if (query.status === 'pending') return <div aria-busy="true">{skeleton}</div>
  if (query.status === 'error' || query.data === undefined) {
    return (
      <Callout
        tone="danger"
        title={errorTitle ?? t('query.errorTitle')}
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            {t('actions.retry')}
          </Button>
        }
      >
        {errorDescription ?? t('query.errorDescription')}
      </Callout>
    )
  }
  if (empty !== undefined && isEmpty(query.data)) return <>{empty}</>
  return <>{children(query.data)}</>
}

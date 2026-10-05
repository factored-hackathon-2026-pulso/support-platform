import { SearchX } from 'lucide-react'
import {
  Button,
  EmptyState,
  LanguageMarks,
  QueryState,
  Skeleton,
  SourceNote,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
  type QueryLike,
} from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import type { AdminUser, AdminUserList } from '../types'
import { AccountStatusText } from './AccountStatusText'
import { RoleChips } from './RoleChips'

export interface UsersTableProps {
  query: QueryLike<AdminUserList>
  selectedId: string | null
  /** Filters are set: the empty state offers "Limpiar filtros". */
  filtered: boolean
  now: number
  onSelect(staffId: string): void
  onClearFilters(): void
}

/**
 * "Personas" (Admin `usuarios`, contract §10.2): one row per person with her
 * roles, languages, team and account status. Selecting a row opens her aside
 * (`?person=`).
 */
export function UsersTable({
  query,
  selectedId,
  filtered,
  now,
  onSelect,
  onClearFilters,
}: UsersTableProps) {
  const { t } = useTranslation(['admin', 'common'])
  return (
    <section aria-label={t('users.table')} className="flex min-w-0 grow flex-col">
      {/* The error Callout of QueryState gets the page gutter. */}
      <div className="flex min-h-0 grow flex-col [&>[role=alert]]:mx-7 [&>[role=alert]]:my-4">
        <QueryState
          query={query}
          skeleton={<RowsSkeleton />}
          errorTitle={t('users.loadError')}
          isEmpty={(list) => list.items.length === 0}
          empty={
            <EmptyState
              size="compact"
              icon={<SearchX size={36} strokeWidth={1.6} />}
              title={filtered ? t('users.emptyFiltered') : t('users.empty')}
              action={
                filtered ? (
                  <Button variant="secondary" onClick={onClearFilters}>
                    {t('common:filters.clear')}
                  </Button>
                ) : null
              }
            />
          }
        >
          {(list) => (
            <Table aria-label={t('users.table')} stickyHeader wrapperClassName="grow">
              <THead>
                <TRow>
                  <TH className="pl-7">{t('users.columns.person')}</TH>
                  <TH className="w-[220px]">{t('users.columns.roles')}</TH>
                  <TH className="w-[150px]">{t('common:fields.languages')}</TH>
                  <TH className="w-[200px]">{t('common:fields.team')}</TH>
                  <TH className="w-[120px] pr-7">{t('users.columns.account')}</TH>
                </TRow>
              </THead>
              <TBody>
                {list.items.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    selected={user.id === selectedId}
                    now={now}
                    onSelect={() => onSelect(user.id)}
                  />
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </div>
      <SourceNote className="px-7">{t('users.source')}</SourceNote>
    </section>
  )
}

interface UserRowProps {
  user: AdminUser
  selected: boolean
  now: number
  onSelect(): void
}

function UserRow({ user, selected, now, onSelect }: UserRowProps) {
  const { t } = useTranslation('admin')
  return (
    <TRow selected={selected} onSelect={onSelect}>
      <TCell className="max-w-[280px] pl-7">
        <span className="flex min-w-0 flex-col py-1.5">
          <TRowSelect className="truncate">{user.name}</TRowSelect>
          <span className="truncate text-12 text-muted">{user.email}</span>
        </span>
      </TCell>
      <TCell>
        <RoleChips roles={user.roles} />
      </TCell>
      <TCell muted>
        {user.languages.length > 0 ? (
          <LanguageMarks languages={user.languages} />
        ) : (
          <span title={t('noLanguages')}>—</span>
        )}
      </TCell>
      <TCell muted className="max-w-[200px] truncate" title={user.team.name}>
        {user.team.name}
      </TCell>
      <TCell className="pr-7">
        <AccountStatusText user={user} now={now} />
      </TCell>
    </TRow>
  )
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-7 py-3">
      {[0, 1, 2, 3, 4].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  )
}

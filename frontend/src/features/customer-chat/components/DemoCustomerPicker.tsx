import { UserRound } from 'lucide-react'
import {
  Badge,
  Callout,
  cardClasses,
  EmptyState,
  QueryState,
  SampleDataTag,
  Skeleton,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { closedConversationsLine, localeLabel, pickerBadge, placeLabel } from '../model'
import { useDemoCustomers } from '../hooks'
import type { DemoCustomer } from '../types'

export interface DemoCustomerPickerProps {
  /** Customer being signed in (its card shows a busy state). */
  startingId: string | null
  /** Why the last sign-in failed, if it did. */
  error: string | null
  onPick: (customerId: string) => void
}

/** "Elige un cliente de ejemplo": seeded customers (invented people) to chat as. */
export function DemoCustomerPicker({ startingId, error, onPick }: DemoCustomerPickerProps) {
  const customers = useDemoCustomers()
  return (
    <section
      aria-labelledby="picker-title"
      className="mx-auto flex w-full max-w-[880px] flex-col gap-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="picker-title" className="m-0 font-display text-20 font-bold">
            Elige un cliente de ejemplo
          </h2>
          <p className="m-0 text-14 text-ink-2">
            Escribe como ese cliente. El caso llega a una analista disponible que hable su idioma.
          </p>
        </div>
        <SampleDataTag />
      </div>
      {error ? (
        <Callout tone="danger" title="No se abrió la sesión">
          {error}
        </Callout>
      ) : null}
      <QueryState
        query={customers}
        skeleton={<PickerSkeleton />}
        isEmpty={(list) => list.items.length === 0}
        empty={
          <EmptyState
            icon={<UserRound size={36} strokeWidth={1.6} aria-hidden="true" />}
            title="No hay clientes de ejemplo"
            description="El backend no cargó datos de ejemplo (CC_SEED_DEMO_DATA)."
          />
        }
        errorTitle="No pudimos cargar los clientes de ejemplo"
        errorDescription="Revisa que el backend esté corriendo e inténtalo de nuevo."
      >
        {(list) => (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((customer) => (
              <li key={customer.id}>
                <CustomerCard
                  customer={customer}
                  busy={startingId === customer.id}
                  disabled={startingId !== null}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  )
}

function CustomerCard({
  customer,
  busy,
  disabled,
  onPick,
}: {
  customer: DemoCustomer
  busy: boolean
  disabled: boolean
  onPick: (customerId: string) => void
}) {
  const badge = pickerBadge(customer)
  const past = closedConversationsLine(customer.closedConversationCount)
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={() => onPick(customer.id)}
      className={cn(
        cardClasses({ padding: 'md', interactive: true }),
        'flex h-full w-full cursor-pointer flex-col items-start gap-1.5 text-left disabled:cursor-wait',
        busy && 'border-ink',
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="text-16 font-semibold">{customer.displayName}</span>
        {badge ? (
          <Badge tone={badge.tone} size="sm">
            {badge.text}
          </Badge>
        ) : null}
      </span>
      <span className="text-13 text-ink-2">{localeLabel(customer.locale)}</span>
      <span className="text-13 text-ink-2">{placeLabel(customer.city, customer.country)}</span>
      {past ? <span className="text-12 text-muted">{past}</span> : null}
      {busy ? <span className="text-12 text-muted">Abriendo sesión…</span> : null}
    </button>
  )
}

function PickerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((n) => (
        <Skeleton key={n} className="h-24 w-full" />
      ))}
    </div>
  )
}

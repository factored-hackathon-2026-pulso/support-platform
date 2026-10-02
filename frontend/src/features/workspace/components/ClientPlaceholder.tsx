import { Accordion, AccordionItem, Avatar, QueryState, Skeleton } from '@/components/ui'
import { RoutingSummary, useCaseDetail } from '@/features/conversation'
import { customerHeaderId, customerHeaderLine } from '../model'

const FILE_SECTIONS = [
  'Productos',
  'Reclamos',
  'Contactos recientes',
  'Contacto',
  'Quién vio qué',
] as const

export interface ClientPlaceholderProps {
  caseId: string
}

/**
 * Cliente tab: the customer header (from the case detail), "Cómo llegó a ti"
 * and the client-file sections, which arrive with slice 2.
 */
export function ClientPlaceholder({ caseId }: ClientPlaceholderProps) {
  const detail = useCaseDetail(caseId)
  return (
    <div className="flex min-h-0 grow scrollbar-thin flex-col gap-3.5 overflow-y-auto px-[18px] py-4">
      <QueryState
        query={detail}
        skeleton={<ClientHeaderSkeleton />}
        errorTitle="No pudimos cargar los datos del cliente"
      >
        {({ customer }) => (
          <div className="flex items-center gap-3">
            <Avatar name={customer.displayName} size="lg" decorative />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="m-0 truncate text-16 font-semibold">{customer.displayName}</h2>
              <span className="text-13 text-ink-2">{customerHeaderLine(customer)}</span>
              <span className="font-mono text-12 text-muted">{customerHeaderId(customer)}</span>
            </div>
          </div>
        )}
      </QueryState>

      <RoutingSummary caseId={caseId} />

      <Accordion>
        {FILE_SECTIONS.map((title) => (
          <AccordionItem key={title} value={title} title={title}>
            <p className="m-0 py-2 text-13 text-muted">
              Llega en la próxima entrega con la ficha del cliente.
            </p>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

function ClientHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-11 rounded-full" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}

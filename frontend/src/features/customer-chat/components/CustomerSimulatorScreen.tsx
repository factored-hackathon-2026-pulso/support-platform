import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { Badge, Button, PageHeader } from '@/components/ui'
import { RealtimeProvider, type WebSocketFactory } from '@/lib/realtime'
import { describeStartFailure, localeLabel } from '../model'
import { useCustomerSession, useDemoCustomers, type CustomerSession } from '../hooks'
import { createCustomerChatHandlers } from '../realtime'
import { createCustomerRealtimeClient } from '../realtime-client'
import { CustomerChat } from './CustomerChat'
import { DemoCustomerPicker } from './DemoCustomerPicker'

export interface CustomerSimulatorScreenProps {
  /** Tests only: fake socket for the customer realtime client. The route passes nothing. */
  createSocket?: WebSocketFactory
}

/**
 * /cliente — customer chat simulator, a dev/demo tool outside the staff shell:
 * pick a seeded customer, chat as them, and answer from the Workspace in another
 * window. It runs its own customer session, API client and socket, apart from
 * any staff session in the same tab.
 */
export function CustomerSimulatorScreen({ createSocket }: CustomerSimulatorScreenProps = {}) {
  const { session, start, end } = useCustomerSession()
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Page
        header={
          <PageHeader
            title="Simulador de cliente"
            subtitle="Escribe como un cliente de la app y responde desde el Workspace en otra ventana"
            actions={<Badge tone="accent">Herramienta de desarrollo</Badge>}
            className="bg-surface"
          />
        }
      >
        <PageBody className="flex min-h-0 flex-col">
          {session ? (
            <SimulatorChat session={session} createSocket={createSocket} onLeave={end} />
          ) : (
            <DemoCustomerPicker
              startingId={start.isPending ? (start.variables ?? null) : null}
              error={start.isError ? describeStartFailure(start.error) : null}
              onPick={(customerId) => start.mutate(customerId)}
            />
          )}
        </PageBody>
      </Page>
    </div>
  )
}

function SimulatorChat({
  session,
  createSocket,
  onLeave,
}: {
  session: CustomerSession
  createSocket?: WebSocketFactory
  onLeave: () => void
}) {
  // One socket and one registry per simulator mount, built before it connects.
  const [client] = useState(() => createCustomerRealtimeClient(createSocket))
  const [handlers] = useState(createCustomerChatHandlers)
  const customers = useDemoCustomers()
  const me = customers.data?.items.find((customer) => customer.id === session.customerId)

  return (
    <RealtimeProvider client={client} handlers={handlers} token={session.token}>
      <div className="flex min-h-0 grow flex-col gap-4">
        <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-3">
          <p className="m-0 text-14 text-ink-2">
            Hablando como{' '}
            <span className="font-semibold text-ink">
              {me?.displayName ?? 'cliente de ejemplo'}
            </span>
            {me ? ` · ${localeLabel(me.locale)}` : null}
            <span className="font-mono text-12 text-muted"> · {session.customerId}</span>
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={<LogOut size={14} aria-hidden="true" />}
            onClick={onLeave}
          >
            Cambiar de cliente
          </Button>
        </div>
        <div className="min-h-0 grow">
          {/* The customer's language comes with the list: wait for it so the
            chat does not switch language once it arrives. */}
          {customers.isPending ? null : (
            <CustomerChat
              customerId={session.customerId}
              suggestions={me?.suggestions ?? []}
              language={me?.language ?? 'es'}
            />
          )}
        </div>
      </div>
    </RealtimeProvider>
  )
}

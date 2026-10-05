import { useState } from 'react'
import { ArrowLeftRight, LogOut } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { Badge, Button, LanguageMarks, PageHeader } from '@/components/ui'
import { RealtimeProvider, type WebSocketFactory } from '@/lib/realtime'
import { describeCustomerCallFailure, isCustomerCallActive, type SimChannel } from '../channels'
import { describeStartFailure, localeLabel } from '../model'
import {
  useCustomerCall,
  useCustomerChatLive,
  useCustomerSession,
  useDemoCustomers,
  useSimulatorAiEnabled,
  useStartCustomerCall,
  type CustomerSession,
} from '../hooks'
import { createCustomerChatHandlers } from '../realtime'
import { createCustomerRealtimeClient } from '../realtime-client'
import { ChannelPicker } from './ChannelPicker'
import { CustomerCallView } from './CustomerCallView'
import { CustomerChat } from './CustomerChat'
import { CustomerMailView } from './CustomerMailView'
import { DemoCustomerPicker } from './DemoCustomerPicker'
import { IncomingCallBanner } from './IncomingCallBanner'

export interface CustomerSimulatorScreenProps {
  /** Tests only: fake socket for the customer realtime client. The route passes nothing. */
  createSocket?: WebSocketFactory
  /**
   * The channel the customer uses (`?channel=` in the route); null = the channel picker.
   * Without `onChannelChange` the screen keeps it itself, starting at `channel`.
   */
  channel?: SimChannel | null
  onChannelChange?(channel: SimChannel | null): void
}

/**
 * /customer — customer simulator, a dev/demo tool outside the staff shell: pick a seeded
 * customer, then how they reach the bank (chat, a call, an email; slice 12), and answer from
 * the Workspace in another window. It runs its own customer session, API client and socket,
 * apart from any staff session in the same tab.
 */
export function CustomerSimulatorScreen({
  createSocket,
  channel: channelProp = null,
  onChannelChange,
}: CustomerSimulatorScreenProps = {}) {
  const { session, start, end } = useCustomerSession()
  const [ownChannel, setOwnChannel] = useState<SimChannel | null>(channelProp)
  const channel = onChannelChange ? channelProp : ownChannel
  const setChannel = onChannelChange ?? setOwnChannel
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Page
        header={
          <PageHeader
            title="Simulador de cliente"
            subtitle="Actúa como un cliente y responde desde el Workspace en otra ventana"
            actions={<Badge tone="accent">Herramienta de desarrollo</Badge>}
            className="bg-surface"
          />
        }
      >
        <PageBody className="flex min-h-0 flex-col">
          {session ? (
            <SimulatorSession
              session={session}
              createSocket={createSocket}
              channel={channel}
              onChannelChange={setChannel}
              onLeave={() => {
                end()
                setChannel(null)
              }}
            />
          ) : (
            <DemoCustomerPicker
              startingId={start.isPending ? (start.variables ?? null) : null}
              error={start.isError ? describeStartFailure(start.error) : null}
              onPick={(customerId) => {
                setChannel(null)
                start.mutate(customerId)
              }}
            />
          )}
        </PageBody>
      </Page>
    </div>
  )
}

function SimulatorSession({
  session,
  createSocket,
  channel,
  onChannelChange,
  onLeave,
}: {
  session: CustomerSession
  createSocket?: WebSocketFactory
  channel: SimChannel | null
  onChannelChange(channel: SimChannel | null): void
  onLeave: () => void
}) {
  // One socket and one registry per simulator mount, built before it connects.
  const [client] = useState(() => createCustomerRealtimeClient(createSocket))
  const [handlers] = useState(createCustomerChatHandlers)
  return (
    <RealtimeProvider client={client} handlers={handlers} token={session.token}>
      <SimulatorBody
        customerId={session.customerId}
        channel={channel}
        onChannelChange={onChannelChange}
        onLeave={onLeave}
      />
    </RealtimeProvider>
  )
}

function SimulatorBody({
  customerId,
  channel,
  onChannelChange,
  onLeave,
}: {
  customerId: string
  channel: SimChannel | null
  onChannelChange(channel: SimChannel | null): void
  onLeave: () => void
}) {
  useCustomerChatLive(customerId)
  const aiEnabled = useSimulatorAiEnabled()
  const customers = useDemoCustomers()
  const me = customers.data?.items.find((customer) => customer.id === customerId)
  const language = me?.language ?? 'es'
  const call = useCustomerCall(customerId).data ?? null
  const startCall = useStartCustomerCall(customerId)

  function pick(next: SimChannel) {
    if (next !== 'call' || isCustomerCallActive(call)) {
      onChannelChange(next)
      return
    }
    // "Llamar" dials at once: the call view opens on "Llamando…".
    startCall.mutate({ key: crypto.randomUUID() }, { onSuccess: () => onChannelChange('call') })
  }

  return (
    <div className="flex min-h-0 grow flex-col gap-4" data-ai-enabled={aiEnabled}>
      <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-14 text-ink-2">
          <p className="m-0">
            Hablando como{' '}
            <span className="font-semibold text-ink">
              {me?.displayName ?? 'cliente de ejemplo'}
            </span>
          </p>
          {me ? <LanguageMarks languages={[me.language]} name={localeLabel(me.locale)} /> : null}
          <span className="font-mono text-12 text-muted">{customerId}</span>
        </div>
        <div className="flex gap-2">
          {channel ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeftRight size={14} aria-hidden="true" />}
              onClick={() => onChannelChange(null)}
            >
              Cambiar de canal
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            icon={<LogOut size={14} aria-hidden="true" />}
            onClick={onLeave}
          >
            Cambiar de cliente
          </Button>
        </div>
      </div>
      {channel === 'call' ? null : (
        <IncomingCallBanner
          customerId={customerId}
          call={call}
          language={language}
          onAnswered={() => onChannelChange('call')}
        />
      )}
      {/* The customer's language comes with the list: wait for it so the view does not
        switch language once it arrives. */}
      {customers.isPending ? null : channel === null ? (
        <ChannelPicker
          firstName={me?.displayName.split(' ')[0] ?? 'el cliente'}
          busy={startCall.isPending ? 'call' : null}
          error={startCall.isError ? describeCustomerCallFailure(startCall.error, 'es') : null}
          onPick={pick}
        />
      ) : (
        <div className="min-h-0 grow">
          {channel === 'chat' ? (
            <CustomerChat
              customerId={customerId}
              suggestions={me?.suggestions ?? []}
              language={language}
            />
          ) : channel === 'call' ? (
            <CustomerCallView customerId={customerId} language={language} />
          ) : (
            <CustomerMailView
              customerId={customerId}
              customerName={me?.displayName ?? ''}
              language={language}
            />
          )}
        </div>
      )}
    </div>
  )
}

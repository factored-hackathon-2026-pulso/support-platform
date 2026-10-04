import { Inbox, Mail, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import {
  Badge,
  Button,
  Callout,
  DocumentTitle,
  EmptyState,
  QueryState,
  Skeleton,
} from '@/components/ui'
import { formatRelativeTime } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { DEV_EMAIL_KIND_LABEL, inAppPath } from '../model'
import { useDevMailbox, useMeta } from '../hooks/use-onboarding'
import type { DevEmail } from '../types'

/**
 * "Correos de desarrollo" (`/dev/correos`, part 4): what the platform "sent" in this
 * environment (the backend's dev mailbox), so a demo can open an invitation or reset
 * link without a real inbox. Only when `/meta` says the dev mailbox is on; it never
 * exists in production.
 */
export function DevMailboxScreen() {
  const meta = useMeta()
  const enabled = meta.data?.devMailbox === true
  const mailbox = useDevMailbox(enabled)
  const now = useNow(30_000)

  return (
    <div className="min-h-dvh bg-canvas px-4 py-10 text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5">
        <DocumentTitle title="Correos de desarrollo" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-30 font-bold">Correos de desarrollo</h1>
            <p className="m-0 text-14 text-ink-2">
              Los correos más recientes de este entorno, del más nuevo al más viejo.
            </p>
          </div>
          {enabled ? (
            <Button
              variant="secondary"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              loading={mailbox.isFetching}
              onClick={() => void mailbox.refetch()}
            >
              Actualizar
            </Button>
          ) : null}
        </div>
        <Callout tone="warn" title="Herramienta de desarrollo">
          Muestra los correos que la plataforma envió en este entorno. No existe en producción.
        </Callout>
        {meta.isPending ? (
          <Skeleton className="h-24" />
        ) : !enabled ? (
          <EmptyState
            as="h2"
            icon={<Inbox size={32} strokeWidth={1.6} />}
            title="No disponible"
            description="Este entorno no guarda correos de desarrollo."
            action={
              <Link to="/login" className="text-14 text-link font-semibold">
                Ir a Entrar
              </Link>
            }
          />
        ) : (
          <QueryState
            query={mailbox}
            skeleton={<Skeleton className="h-40" />}
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                as="h2"
                icon={<Inbox size={32} strokeWidth={1.6} />}
                title="Todavía no hay correos"
                description="Cuando administración invite a alguien o le envíe un enlace, aparece aquí."
              />
            }
            errorTitle="No pudimos cargar los correos"
          >
            {(data) => (
              <ul aria-label="Correos" className="m-0 flex list-none flex-col gap-3 p-0">
                {data.items.map((email) => (
                  <DevEmailItem key={email.id} email={email} now={now} />
                ))}
              </ul>
            )}
          </QueryState>
        )}
      </div>
    </div>
  )
}

function DevEmailItem({ email, now }: { email: DevEmail; now: number }) {
  const path = inAppPath(email.link)
  return (
    <li>
      <article
        aria-label={email.subject}
        className="flex flex-col gap-3 rounded-14 border border-border bg-surface px-5 py-4"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 text-16 font-semibold">{email.subject}</h2>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-2">
              <span className="flex items-center gap-1.5">
                <Mail size={14} aria-hidden="true" className="text-muted" />
                <span className="sr-only">Para: </span>
                {email.to}
              </span>
              <time dateTime={email.sentAt}>{formatRelativeTime(email.sentAt, now)}</time>
            </span>
          </div>
          <Badge tone={email.kind === 'invitation' ? 'accent' : 'warn'} size="sm">
            {DEV_EMAIL_KIND_LABEL[email.kind]}
          </Badge>
        </header>
        <p className="m-0 text-14 leading-[1.5] whitespace-pre-wrap text-ink-2">{email.text}</p>
        {path ? (
          <Link
            to={path}
            aria-label={`Abrir enlace: ${email.subject} para ${email.to}`}
            className="self-start text-14 text-link font-semibold"
          >
            Abrir enlace
          </Link>
        ) : null}
      </article>
    </li>
  )
}

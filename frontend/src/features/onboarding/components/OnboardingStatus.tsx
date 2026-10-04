import { Button, Callout, Spinner } from '@/components/ui'

/** While a link is checked (the token is sent once). */
export function CheckingLink() {
  return (
    <div className="flex justify-center py-10 text-muted">
      <Spinner label="Revisando el enlace" size={24} />
    </div>
  )
}

/** The check failed for another reason (network, too many attempts). */
export function CheckFailed({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry(): void
}) {
  return (
    <Callout
      tone="danger"
      title="No pudimos revisar el enlace"
      actions={
        <Button size="sm" loading={retrying} onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      {message}
    </Callout>
  )
}

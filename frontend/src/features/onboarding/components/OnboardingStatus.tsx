import { Button, Callout, Spinner } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

/** While a link is checked (the token is sent once). */
export function CheckingLink() {
  const { t } = useTranslation('onboarding')
  return (
    <div className="flex justify-center py-10 text-muted">
      <Spinner label={t('link.checking')} size={24} />
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
  const { t } = useTranslation(['onboarding', 'common'])
  return (
    <Callout
      tone="danger"
      title={t('link.checkFailed')}
      actions={
        <Button size="sm" loading={retrying} onClick={onRetry}>
          {t('common:actions.retry')}
        </Button>
      }
    >
      {message}
    </Callout>
  )
}

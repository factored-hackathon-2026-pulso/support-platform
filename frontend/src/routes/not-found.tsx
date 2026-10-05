import { Compass } from 'lucide-react'
import { useCurrentRole } from '@/app/session'
import { Page, PageBody } from '@/components/layout'
import { EmptyState, LinkButton, PageHeader } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

/** 404 inside the staff shell: keeps the rail of the user's first role. */
export default function NotFoundRoute() {
  const role = useCurrentRole()
  const { t } = useTranslation('shell')
  return (
    <Page header={<PageHeader title={t('notFound.title')} />}>
      <PageBody className="flex items-center justify-center">
        <EmptyState
          icon={<Compass size={40} strokeWidth={1.6} />}
          title={t('notFound.heading')}
          description={t('notFound.text')}
          action={
            <LinkButton to={role.home} variant="primary">
              {t('notFound.goTo', { place: role.label.toLowerCase() })}
            </LinkButton>
          }
        />
      </PageBody>
    </Page>
  )
}

import { Compass } from 'lucide-react'
import { useCurrentRole } from '@/app/session'
import { Page, PageBody } from '@/components/layout'
import { EmptyState, LinkButton, PageHeader } from '@/components/ui'

/** 404 inside the staff shell: keeps the rail of the user's first role. */
export default function NotFoundRoute() {
  const role = useCurrentRole()
  return (
    <Page header={<PageHeader title="Página no encontrada" />}>
      <PageBody className="flex items-center justify-center">
        <EmptyState
          icon={<Compass size={40} strokeWidth={1.6} />}
          title="Esta dirección no existe"
          description="Puede que el enlace esté incompleto o que la pantalla haya cambiado de lugar."
          action={
            <LinkButton to={role.home} variant="primary">
              Ir a {role.label.toLowerCase()}
            </LinkButton>
          }
        />
      </PageBody>
    </Page>
  )
}

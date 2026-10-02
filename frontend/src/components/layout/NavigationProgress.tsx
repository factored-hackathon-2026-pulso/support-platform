import { useNavigation } from 'react-router'

/**
 * Thin accent bar at the top while a lazy route is loading. The status region
 * stays mounted and only its text changes, so screen readers announce it.
 */
export function NavigationProgress() {
  const navigation = useNavigation()
  const loading = navigation.state !== 'idle'
  return (
    <>
      {loading ? (
        <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden">
          <div className="h-full w-2/5 animate-progress bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
        </div>
      ) : null}
      <output className="sr-only">{loading ? 'Cargando la página' : ''}</output>
    </>
  )
}

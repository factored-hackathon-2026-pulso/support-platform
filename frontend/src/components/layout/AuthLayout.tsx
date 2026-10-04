import { Outlet } from 'react-router'
import { NavigationProgress } from './NavigationProgress'

/** Sign-in layout (no rail): dark brand panel on the left, form on the right. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh bg-canvas text-ink">
      <NavigationProgress />
      <aside
        data-surface="dark"
        className="hidden w-[560px] shrink-0 flex-col justify-between bg-rail px-14 py-12 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-10 bg-rail-active font-display text-15 font-bold"
          >
            CC
          </span>
          <span className="font-display text-18 font-bold">Plataforma CC</span>
        </div>
        <div className="flex flex-col gap-4">
          <p className="m-0 font-display text-40 font-bold tracking-display text-balance">
            Atención al cliente por chat, de principio a fin.
          </p>
          <p className="m-0 text-16 text-rail-icon">
            Contact center de LATAM Bank en México, Colombia y Argentina
          </p>
        </div>
        <span className="text-13 text-faint">Uso exclusivo del personal autorizado del banco.</span>
      </aside>
      <main className="flex grow items-center justify-center p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

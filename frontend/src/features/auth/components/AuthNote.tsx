import type { ReactNode } from 'react'

/** Grey explanatory box under the login forms (policy reminders). One line per child. */
export function AuthNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-12 bg-panel px-4 py-3.5 text-13 leading-[1.5] text-ink-2">
      {children}
    </div>
  )
}

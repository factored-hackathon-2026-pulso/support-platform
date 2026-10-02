import { createContext } from 'react'
import type { RealtimeClient } from './client'

/** Client provided by <RealtimeProvider>; read it with the hooks in hooks.ts. */
export const RealtimeContext = createContext<RealtimeClient | null>(null)

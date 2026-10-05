import { createContext, useContext } from 'react'
import type { MaturingType } from '../types'

export interface BuilderChatRequest {
  /** A first message in the composer; she can edit it. */
  prefill?: string
  /** The case type the conversation is about (the proposal links carry it). */
  type?: MaturingType | null
  /** Start a new conversation instead of continuing her thread ("Proponer un agente"). */
  fresh?: boolean
}

export interface BuilderChatControl {
  /** Open the chat with the builder agent. */
  open(request?: BuilderChatRequest): void
}

/** Provided by `AutomationFrame`: any Automatización screen can open the builder chat. */
export const BuilderChatContext = createContext<BuilderChatControl>({ open: () => undefined })

/** Open the builder chat from inside an Automatización screen ("Proponer un agente"). */
export function useBuilderChatPanel(): BuilderChatControl {
  return useContext(BuilderChatContext)
}

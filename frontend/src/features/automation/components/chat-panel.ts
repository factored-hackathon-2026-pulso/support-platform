import { createContext, useContext } from 'react'
import type { MaturingType } from '../types'

export interface BuilderChatControl {
  /**
   * Open the chat with the builder agent, optionally with a first message in the composer and the
   * case type it is about (the proposal links carry it).
   */
  open(prefill?: string, type?: MaturingType | null): void
}

/** Provided by `AutomationFrame`: any Automatización screen can open the builder chat. */
export const BuilderChatContext = createContext<BuilderChatControl>({ open: () => undefined })

/** Open the builder chat from inside an Automatización screen ("Proponer un agente"). */
export function useBuilderChatPanel(): BuilderChatControl {
  return useContext(BuilderChatContext)
}

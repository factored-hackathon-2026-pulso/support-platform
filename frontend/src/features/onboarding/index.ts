/**
 * Public API of the onboarding feature (part 4): the public invitation and
 * password-reset screens (`/activar`, `/restablecer`) and the dev mailbox
 * (`/dev/correos`). Imports no other feature.
 */
export * from './core'
export { ActivationScreen } from './components/ActivationScreen'
export type { ActivationScreenProps } from './components/ActivationScreen'
export { PasswordResetScreen } from './components/PasswordResetScreen'
export type { PasswordResetScreenProps } from './components/PasswordResetScreen'
export { DevMailboxScreen } from './components/DevMailboxScreen'
export { readToken } from './model'

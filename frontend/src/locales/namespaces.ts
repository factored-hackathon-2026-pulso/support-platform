/**
 * The translation namespaces (slice 23): one per area of the app, so the people migrating
 * different areas never edit the same catalog. `es` is the source (`src/locales/es/<ns>.ts`,
 * `as const`); `pt-BR` has every key (`satisfies Translation<typeof es>`).
 *
 * Adding a namespace: create both files, add it to `NAMESPACES` and `Resources` below.
 */
import type admin from './es/admin'
import type audit from './es/audit'
import type automation from './es/automation'
import type auth from './es/auth'
import type cases from './es/cases'
import type common from './es/common'
import type conversation from './es/conversation'
import type copilot from './es/copilot'
import type customer from './es/customer'
import type home from './es/home'
import type notifications from './es/notifications'
import type onboarding from './es/onboarding'
import type shell from './es/shell'
import type supervision from './es/supervision'
import type workspace from './es/workspace'

export const NAMESPACES = [
  'common',
  'shell',
  'auth',
  'onboarding',
  'home',
  'cases',
  'conversation',
  'copilot',
  'workspace',
  'supervision',
  'audit',
  'automation',
  'admin',
  'notifications',
  'customer',
] as const

export type Namespace = (typeof NAMESPACES)[number]

/** In the entry chunk: every screen needs them before anything else renders. */
export const EAGER_NAMESPACES = ['common', 'shell'] as const satisfies readonly Namespace[]

export interface Resources {
  common: typeof common
  shell: typeof shell
  auth: typeof auth
  onboarding: typeof onboarding
  home: typeof home
  cases: typeof cases
  conversation: typeof conversation
  copilot: typeof copilot
  workspace: typeof workspace
  supervision: typeof supervision
  audit: typeof audit
  automation: typeof automation
  admin: typeof admin
  notifications: typeof notifications
  customer: typeof customer
}

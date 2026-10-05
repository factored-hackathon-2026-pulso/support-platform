/**
 * Areas whose copy is not in the catalogs yet (slice 23b). The literal-strings guard
 * (`i18n-literals.test.ts`) skips their paths; everything else must use `t()`.
 *
 * Migrating an area: move its copy to `src/locales/{es,pt-BR}/<namespace>.ts`, then delete
 * ONLY its block below (blocks are separated by a comment line, so parallel branches merge
 * cleanly). The guard fails while a block lists an area that has no literal left: delete it.
 * `strings` is the count when slice 23a ended, to split the work.
 */

export interface PendingArea {
  /** The area and its namespace. */
  area: string
  /** Path prefixes under `src/`. */
  paths: readonly string[]
  /** Literals found when slice 23a ended (informative). */
  strings: number
}

/** Files that hold locale data on purpose (word tables, a language's own name). */
export const LOCALE_DATA_FILES: readonly string[] = ['src/lib/format.ts', 'src/lib/i18n/locale.ts']

export const PENDING_AREAS: readonly PendingArea[] = [
  // ── conversation: the open case, transcript, channels, close/escalate dialogs, handoff
  { area: 'conversation', paths: ['src/features/conversation/'], strings: 398 },
  // ── admin: Usuarios y roles, Equipos ("Plataforma" is migrated: platform.ts)
  {
    area: 'admin',
    paths: [
      'src/features/admin/model.ts',
      'src/features/admin/components/AccountStatusText.tsx',
      'src/features/admin/components/AddMemberDialog.tsx',
      'src/features/admin/components/CancelInvitationDialog.tsx',
      'src/features/admin/components/CreateTeamDialog.tsx',
      'src/features/admin/components/CreateUserDialog.tsx',
      'src/features/admin/components/DeactivateTeamDialog.tsx',
      'src/features/admin/components/DeactivateUserDialog.tsx',
      'src/features/admin/components/InvitationSentDialog.tsx',
      'src/features/admin/components/ResetPasswordDialog.tsx',
      'src/features/admin/components/RoleChips.tsx',
      'src/features/admin/components/TeamPanel.tsx',
      'src/features/admin/components/TeamsScreen.tsx',
      'src/features/admin/components/UserForm.tsx',
      'src/features/admin/components/UserPanel.tsx',
      'src/features/admin/components/UsersScreen.tsx',
      'src/features/admin/components/UsersTable.tsx',
      'src/features/admin/components/UsersToolbar.tsx',
    ],
    strings: 231,
  },
  // ── supervision: Colas, Equipo, Escalados, the supervisor case view
  { area: 'supervision', paths: ['src/features/supervision/'], strings: 214 },
  // ── cases: the Casos list, cards, priority, case type, close reasons, ratings
  { area: 'cases', paths: ['src/features/cases/'], strings: 123 },
  // ── copilot: Copiloto, Herramientas, the draft, the AI stage strip
  { area: 'copilot', paths: ['src/features/copilot/'], strings: 91 },
  // ── home: Inicio
  { area: 'home', paths: ['src/features/home/'], strings: 90 },
  // ── audit: Auditoría
  { area: 'audit', paths: ['src/features/audit/'], strings: 81 },
  // ── notifications: the bell, its panel and the live toasts
  { area: 'notifications', paths: ['src/features/notifications/'], strings: 57 },
  // ── workspace: the analyst Workspace frame (right panel tabs)
  { area: 'workspace', paths: ['src/features/workspace/'], strings: 17 },
  // ── end of the pending areas
]

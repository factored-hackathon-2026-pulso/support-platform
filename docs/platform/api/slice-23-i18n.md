# Slice 23 · The platform in Spanish and Brazilian Portuguese

**Status:** 23a (foundation) implemented (2026-10-04) on `feat/i18n-foundation`. 23b (the areas)
implemented (2026-10-05) on `feat/i18n-areas` (the seven area branches merged on top of 23a, then the
cross-area pass, §8). 23c planned (§9). Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-04 (23a), 2026-10-05 (23b).

**Scope.** The platform UI (the staff app: analyst, Supervisión, Administración, sign-in and onboarding) in
**es** and **pt-BR**, chosen by each person in the account menu and kept on her profile (ADR 0008). Chat
content is never translated. The customer simulator keeps following the customer's language.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `../adr/0008-platform-i18n.md` (the decisions),
`../../../frontend/ARCHITECTURE.md` §12 (how to write and migrate copy: the guide 23b follows).

---

## 1. Phases

| Phase | What | State |
|---|---|---|
| **23a** | Foundation: i18next, catalogs and types, the format layer, the preference (API + account menu + pre-login detection), the guard rails, and the shared layer migrated (shell, rail, account menu, role names, `components/ui`, toasts and generic errors, session and route-error screens, not found, sign-in, MFA, lockout, invitation, reset, dev mailbox, "Plataforma"). | done |
| **23b** | The areas, in parallel, one agent per area (§5): each moves its copy to its namespace, adds pt-BR tests of its screens and deletes its block from the allow-list. Then the cross-area pass (§8): shared vocabulary loaded with every screen that shows it, the simulator's bubble authors in the customer's language, the pt-BR terminology, a cold-load test and a Portuguese browser scenario. The customer simulator moved to `customer` here (with `getFixedT`). | done |
| **23c** | Server-rendered texts in the person's language (§9). | planned |

## 2. The preference (API)

`StaffPreferences` (`domain/people/preferences.py`, table `staff_preferences`, one row per person, absent =
defaults). `UiLanguage` = `es` | `pt-BR` (BCP 47, as the browser and `Intl` use them; not the `Language` a
person speaks with customers, `es` | `pt`). Default `es`.

| Route | Who | Body / answer |
|---|---|---|
| `GET /api/v1/auth/me` | any staff | now also `preferences: { uiLanguage }` |
| `GET /api/v1/me/preferences` | any staff, her own | `{ uiLanguage }` |
| `PUT /api/v1/me/preferences` | any staff, her own | `{ uiLanguage }` → `{ uiLanguage }`; the same value is no change and no event; an unknown value or an extra field is `422 validation_error` |

- **Event:** `staff.ui_language_changed` (entity `staff`, actor herself with her highest role, payload
  `from_language`, `to_language`). Audit family "Accesos" (her own account, like `staff.mfa_enrolled`), changes
  state, description "Cambió el idioma de la plataforma a Português" (the language by its own name).
- **Realtime:** `preferences.updated` on `staff:<id>` (only that person listens) with `{ uiLanguage }`; the raw
  event never reaches a socket. Her other tabs switch at once.
- **Server-side reader:** `application/people/preferences.py` `ui_language_of(uow, staff_id)` (23c uses it).
- **Why not a column of `staff`:** administration edits a person with `expectedVersion`; her own language change
  would make that edit stale (`409 version_conflict`).
- **Database:** new table; a local database from before must be deleted (no migrations yet).

## 3. The SPA (23a)

- **Library and files:** `src/lib/i18n/` (instance, locale store, `Translation<T>`, `useActiveLocale`,
  `changeLocale`, `loadAllCatalogs`), `src/locales/{es,pt-BR}/<namespace>.ts`, `src/locales/namespaces.ts`
  (the list and the types). `common` and `shell` are in the entry chunk; the rest are lazy chunks, prefetched
  after the first paint.
- **Formatting:** `lib/format.ts` follows the active locale (`{ locale }` forces one): numbers and money with
  `Intl`, dates and times in the viewer's zone, relative times "hace 5 min" / "há 5 min", `formatList`
  ("A, B y C" / "A, B e C"). Spanish output is unchanged (its tests are untouched).
- **Preference:** `app/preferences.ts` (`usePreferences`, primed by `/auth/me`; `UiLanguageSync` applies it and
  remembers it for the sign-in screens; `useSetUiLanguage` is optimistic and rolls back with a toast;
  `registerPreferencesRealtime`). The account menu shows "Idioma de la plataforma" (globe) with "Español" and
  "Português" (own names, `lang`, `aria-pressed`) between her facts and "Cambiar de rol".
- **Before sign-in:** the stored choice (`localStorage` `cc.ui-language`), else the browser (es / pt), else es.
  `<html lang>` and the tab title suffix ("LATAM Bank Soporte" / "LATAM Bank Suporte") follow.
- **Terms in Portuguese:** caso, fila (Colas), equipe, atendimento, supervisão, administração, analista,
  perfil (rol), escalados, auditoria, "Sair" (Cerrar sesión), "Tentar de novo" (Reintentar), e-mail (correo).

## 4. Guard rails

- `src/test/i18n-literals.test.ts` (+ `i18n-literals.ts`, the TypeScript-AST scanner): fails on copy outside
  the catalogs: JSX text, prose-like strings in `.tsx` (outside technical places: classes, ids, keys, `t()`
  arguments, errors…), accented strings in `.ts`. `// i18n-ignore` / `// i18n-ignore-next-line` for a deliberate
  literal (a language's own name, the auth scheme). Pending areas: `src/test/i18n-allowlist.ts`; the test also
  fails while it lists an area with nothing left. `I18N_REPORT=1 pnpm test i18n-literals` prints what is left.
- `src/lib/i18n/catalogs.test.ts`: every namespace has both files, the same keys and the same placeholders,
  no empty value. The compiler checks the keys too (`satisfies Translation<typeof es>`).
- Testing utilities: `renderRoute` / `renderWithProviders` take `locale` (also her saved preference);
  `setTestLocale(locale)` switches mid-test; every catalog is preloaded in tests.
- e2e: `e2e/i18n.spec.ts` (a throwaway admin switches to Português on "Plataforma": the rail, the menu and the
  screen change, `<html lang>`, the tab title; a reload keeps it; signed out, the login is in Portuguese).

## 5. The areas of 23b (as split; all migrated)

Rough counts from `I18N_REPORT=1` at the end of 23a (prose-like literals, `.ts` included; a few are technical
noise). Suggested split for parallel agents, each on its own branch, each editing only its namespace, its
feature folder and its block of the allow-list:

| Agent | Area (namespace) | Paths | ~Strings |
|---|---|---|---|
| 1 | `conversation` | `features/conversation/` | 398 |
| 2 | `customer` (simulator; language follows the customer: `i18n.getFixedT(customerLocale, 'customer')`, today's es / pt maps become the two catalogs) | `features/customer-chat/` | 310 |
| 3 | `admin` (Usuarios y roles, Equipos) | `features/admin/model.ts`, `features/admin/components/*` except `PlatformScreen.tsx` | 231 |
| 4 | `supervision` | `features/supervision/` | 214 |
| 5 | `cases` + `workspace` | `features/cases/`, `features/workspace/` | 123 + 17 |
| 6 | `copilot` + `home` | `features/copilot/`, `features/home/` | 91 + 90 |
| 7 | `audit` + `notifications` | `features/audit/`, `features/notifications/` | 81 + 57 |

Shared vocabulary that several areas show (case status words, priority, channel, rating, close reasons) lives in
`features/cases` (`core.ts`) and moves with agent 5; until then other areas keep calling those helpers (they
switch language by themselves once migrated, because they read `i18n.t` at call time). The route modules
(`src/routes/*`) have no copy left.

## 6. Done when (23b, per area): met by every area

- No block of the area in `i18n-allowlist.ts`; `pnpm test` green (the guard, the catalogs test).
- Every screen of the area has a render test in pt-BR (`renderRoute(…, { locale: 'pt-BR' })`).
- Spanish copy unchanged (the existing tests still pass untouched, except imports of renamed copy constants).
- No `joinEs` / `pluralize` left in the area (use `formatList` and catalog plurals).

## 7. Known gaps (after 23b)

- Server-rendered texts are Spanish in a pt-BR UI until 23c (§9).
- `es` and `pt-BR` only. CLDR also has a `many` plural category for large round numbers (1 000 000); catalogs
  write `_one` and `_other`, so such a count would show the key; no screen counts that high.

## 8. 23b: the cross-area pass (2026-10-05)

After the merge of the seven area branches (`feat/i18n-{audit,supervision,cases,copilot,customer,admin,
conversation}`; the allow-list is empty):

- **Shared vocabulary loads with the screen.** A model that calls another area's helper reads that
  namespace at call time; when it is not loaded yet (a deep link on a first visit, before the background
  prefetch arrives) i18next prints the key and nothing re-renders when it arrives. Every `supervision` and
  `notifications` component that reads its own namespace now loads `cases` and `conversation` with it
  (case vocabulary; language and queue names), the `home` components and the Workspace load `cases`; `conversation` and the
  `cases` components already did. Rule in `frontend/ARCHITECTURE.md` §12.
- **Whole sentences.** The supervision and notification sentences around a language name ("Casos
  abiertos en {{language}}", "Nadie con ese nombre habla {{language}}.", "(regla 3)", "Un caso espera en
  la cola en {{language}}") are whole catalog keys with the language as a parameter; `countryName` and
  `channelFact` read `cases`. Spanish output unchanged.
- **The simulator's bubble authors** follow the customer's language: "{{name}}, de LATAM Bank" / "{{name}},
  do LATAM Bank" (`customer:chat.bankAuthor`), and the fallback assistant name "Asistente virtual" /
  "Assistente virtual" (`customer:assistant.name`); `toChatItems(cache, language)`.
- **Terminology** in the pt-BR catalogs (checked across all namespaces): atribuir / reatribuir, assumir o
  caso, sem responsável, escalonamento (verb escalar), fila, encerrar / encerrado (a case; "Fechar" only
  closes a panel), Status, A responder, transferência, perfil, convite, Assistente virtual.
- **`pluralize` and `joinEs`** (Spanish-only) are gone from `lib/format.ts`: nothing used them.
- **Tests.** `src/test/i18n-cold-load.test.tsx`: Início, a case in Casos, a case under supervision, Filas,
  Equipe, Escalados, Auditoria, Usuários e perfis and a team in Equipes, each a deep link in pt-BR with
  only `common` and `shell` loaded (`src/test/cold-catalogs.ts`), asserting no catalog key on screen
  (before the fix: Início, Filas and Escalados printed `status.*`, `channel.*`, `languageName.*`,
  `queueLabel.*`, `escalation.*` keys). `e2e/i18n.spec.ts` adds a scenario: a person with the three roles
  switches to Português; Início (she starts working, a Portuguese customer's case arrives), the case in
  Casos (and after a reload, a cold start), Supervisão Filas / Equipe / Escalados / Auditoria,
  Administração Usuários e perfis / Equipes / Plataforma; Portuguese headings and no key on any of them.
- **Gates (2026-10-05):** backend `ruff check`, `ruff format --check` (410 files), `mypy src` (286 files),
  `pytest` 1567 passed, `export_openapi --check` clean (no backend change in 23b); frontend `typecheck`,
  `lint`, `format:check`, `test` 1206 passed in 124 files, `build` (feature catalogs only in lazy chunks),
  `check:api`; `pnpm e2e` 18/18 twice in a row.

**Spanish still reaching a pt-BR screen (on purpose or for 23c).** Data: names, team names ("Equipo
Andes"), case subjects, the escalation motive, messages and the customer notices (chat content is in the
case language, never translated). Languages by their own name ("Español", "Português"). Server texts
(§9): the audit's "Qué hizo" ("Reasignó el caso de …"), the staff-only system lines of the transcript
("Asignado a Daniela Ríos porque está disponible y habla español."), the dev mailbox's emails.

## 9. 23c: what is left (server-rendered texts)

The server reads the viewer's `ui_language_of` (or, for an email to someone not signed in yet, the inviter's
choice or a stored one) and renders:

- **Audit descriptions** ("Qué hizo", the `description` of each audit event): Spanish sentences built when
  the log is read (`application/audit/queries.py`).
- **Staff-only transcript lines** (`routing` / `system` turns: assigned on arrival, from the queue, by
  supervision, reassigned, escalated / withdrawn / answered / taken, released by the assistant, follow-up
  call), `application/cases/copy.py`: written once in Spanish and stored, so each viewer's language needs
  the facts kept with the turn (or the event) and the sentence rendered on read. Customer notices keep the
  case language.
- **Problem details** (`title` / `detail` of every `application/problem+json`): the SPA shows its own copy
  per `code`, so this is for API consumers and logs; low priority.
- **Emails** (invitation, password reset; the dev mailbox shows them): subject and body.
- The audit row of a language change ("Cambió el idioma de la plataforma a Português") follows the audit
  descriptions.

Notifications need nothing: the API sends no text, the SPA builds their copy from the kind (`notifications`
namespace).

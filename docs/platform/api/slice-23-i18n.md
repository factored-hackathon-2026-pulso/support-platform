# Slice 23 · The platform in Spanish and Brazilian Portuguese

**Status:** 23a (foundation) implemented (2026-10-04) on `feat/i18n-foundation`. 23b (the areas)
implemented (2026-10-05) on `feat/i18n-areas` (the seven area branches merged on top of 23a, then the
cross-area pass, §8). 23c (server-rendered texts) implemented (2026-10-05) on `feat/i18n-server` (§9).
Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-04 (23a), 2026-10-05 (23b, 23c).

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
| **23c** | Server-rendered texts in the person's language (§9): audit descriptions (server catalogs per language), staff-only transcript lines (facts on the turn, written by the SPA), invitation and password-reset emails (the recipient's language, chosen at invitation). | done |

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
  state, description "Cambió el idioma de la plataforma a Português" / "Mudou o idioma da plataforma para
  Português" (23c: in the reader's language; the language by its own name in both).
- **Realtime:** `preferences.updated` on `staff:<id>` (only that person listens) with `{ uiLanguage }`; the raw
  event never reaches a socket. Her other tabs switch at once.
- **Server-side reader:** `application/people/preferences.py` `ui_language_of(uow, staff_id)` (23c: the audit
  reader's language, the language of her emails). `preset_ui_language` sets it when administration invites
  her (no event: not her own change).
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

- Server-rendered texts were Spanish in a pt-BR UI until 23c (§9; what is still Spanish is listed there).
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
(§9, translated in 23c): the audit's "Qué hizo" ("Reasignó el caso de …"), the staff-only system lines of
the transcript ("Asignado a Daniela Ríos porque está disponible y habla español."), the dev mailbox's emails.

## 9. 23c: server-rendered texts (done, 2026-10-05)

Decision (ADR 0008 §9): **the server renders what only it reads or sends** (the audit log, the emails), in
one catalog module per language; **what travels to many viewers at once carries facts** (a staff-only
transcript line goes out on the shared `case:<id>` socket topic to everyone watching the case, each with
her own language), and the SPA writes the sentence from its catalogs, as it already does for notifications.

### 9.1 Server catalogs

`backend/src/cc_platform/application/i18n/`: `es.py` (the source) and `pt_br.py`, flat namespaced keys
(`audit.caseClosed`, `email.invitation.body`, `priority.high`) with `str.format` placeholders; `texts(language)`
is the translator (`t(key, **params)`, `t.plural(key, count)` → `key_one` / `key_other`, `t.join(items)` →
"A, B y C" / "A, B e C"). `tests/unit/application/test_server_i18n.py` fails when a catalog lacks a key or a
placeholder of the Spanish one, or when the Spanish vocabulary drifts from the stored transcript words
(`cases/copy.py`: language and queue names, close reasons; `admin/copy.py`: role labels). Portuguese terms
follow §3 and §8 (atribuir / reatribuir, assumir o caso, fila, encerrar, escalonamento, transferência, perfil,
convite, e-mail, Supervisão, Administração).

### 9.2 Audit descriptions

`GET /audit/events` and `GET /audit/events/{eventId}` render `description` in the **reader's** saved UI
language (`ListAuditEvents` / `GetAuditEvent` take the reader; `ui_language_of`). Spanish output is
byte-identical (the 23b tests pin it); every emitted event type has a Portuguese sentence and none equals the
Spanish one (`test_the_log_speaks_the_readers_language`). The stored `queue_label` of `case.queued` is a
Spanish snapshot: only the Spanish sentence uses it. The SPA refetches the audit queries once a new language
is saved, in this tab or another (`app/preferences.ts` `refetchServerRenderedTexts`). No API shape change.

### 9.3 Staff-only transcript lines

- A `routing` turn now stores its **facts** next to its Spanish `text`: `StaffLine` (`kind`: `StaffLineKind`,
  `params`: names as they were then, the case language `es` | `pt`, counts, an ISO time), in the `turns.staff_line`
  JSON column, the `turn.created` event payload (`staff_line`, only when present) and the API `Turn.staffLine`
  (`{ kind, params }` or `null`; the parameters per kind are listed on the `StaffLine` schema). Builders:
  `application/cases/staff_lines.py` (the stored text is still `copy.py`'s, unchanged). The seed writes facts too.
- Kinds: `assigned_on_arrival`, `assigned_from_assistant`, `queued`, `assigned_from_queue`, `wrote_again`,
  `assigned_by_supervision`, `reassigned` (both with `paused`), `escalated`, `escalation_withdrawn`,
  `escalation_answered`, `escalation_taken`, `assistant_released`, `follow_up_call`.
- The SPA (`features/conversation/model.ts` `staffLineText`, `turnText`; `conversation:staffLine.*`) writes the
  line in the viewer's language in the transcript and in the Escalados panel's last messages; the Spanish
  catalog repeats the server's sentences. A line without facts (stored before 23c) or with facts this version
  cannot read shows its stored text. `wrote_again` shows the previous closing in the viewer's zone (the stored
  text names "hora Bogotá").
- The audit redacts `staff_line` like the turn text (listed in `redactedFields`, no length).
- Customer-visible notices (opened, closed, reassigned, call lines, the assistant's handover) stay in the case
  language: they are chat content.
- The staff transcript names the virtual assistant from the catalog ("Asistente virtual" / "Assistente
  virtual"), not from the server's Spanish `authorName`.
- A local database from before 23c lacks `turns.staff_line`: delete it (no migrations yet).

### 9.4 Emails and the invitation's language

- `POST /admin/users` takes `uiLanguage` (`es` | `pt-BR`, default `es`): administration picks the invitee's
  platform language ("Idioma de la plataforma" in "Nuevo usuario", Español by default). It becomes her
  preference (`staff_preferences`), so the invitation, its resends and her later reset links are in it, and her
  first sign-in opens in it. A reset follows her own preference.
- `POST /onboarding/invitations/check` and `/password-resets/check` return `uiLanguage`; the activation and reset
  screens switch to it and remember it for the sign-in that follows.
- Templates: `email.invitation.*`, `email.reset.*` (Spanish byte-identical; Portuguese subjects "Seu convite para
  a Plataforma CC do LATAM Bank", "Crie uma nova senha para a Plataforma CC"). The seeded Bruna Esteves is
  invited in Portuguese, so the dev mailbox shows both languages.

### 9.5 Still Spanish, and why

- **Problem details** (`title` / `detail` of `application/problem+json` and WebSocket `error` envelopes): the
  SPA never shows them (it maps each `code` to its own copy in both languages); they are developer-facing text
  for API consumers and logs, spread over ~180 raise sites. Translating them would mean a catalog entry per
  error and a language source for anonymous requests; not worth it now. Documented as a known gap.
- **The stored `text` of a routing turn**, the inbox `preview` when a case's last turn is a routing line (only a
  follow-up call case before its first message), and turn texts sent to the AI services: kept in Spanish on
  purpose (one stored sentence; the facts carry the translation).
- **Data**: names, team names, case subjects, motives, messages, and the customer notices (chat content in the
  case language). Languages by their own name.
- `es` and `pt-BR` only (as in §7).

### 9.6 Gates (2026-10-05)

Backend `ruff check`, `ruff format --check` (419 files), `mypy src` (290 files), `pytest` 1588 passed,
`export_openapi --check` clean; frontend `typecheck`, `lint`, `format:check`, `test` 1217 passed in 125 files,
`build`, `check:api`; `pnpm e2e` 18/18 twice in a row (the Portuguese walk now checks the case's assignment
line and the case's audit in Portuguese).

Notifications need nothing: the API sends no text, the SPA builds their copy from the kind (`notifications`
namespace).

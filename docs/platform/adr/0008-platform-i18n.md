# ADR 0008 · Platform UI in Spanish and Brazilian Portuguese

- Status: **Accepted** (user decision of 2026-10-04). 23a (the foundation) is built: contract
  `api/slice-23-i18n.md`. 23b (the areas) and 23c (server-rendered texts, Portuguese e2e) are planned there.
- Date: 2026-10-04
- Scope: `frontend/` (the staff app and, without changing its behaviour, the customer simulator), `backend/`
  (the preference; server texts in 23c).
- Related: `ENGINEERING_BRIEF.md` (Language rule), `frontend/ARCHITECTURE.md` §12, ADR 0001.
  Number 0007 is taken by an open pull request (the improvement-engine announce route).

## Context

The product was Spanish only: every string of the staff app was written in the components and in the pure
`model.ts` files, the formatters (`lib/format.ts`) printed Spanish words, and only the customer simulator spoke
the customer's language (es / pt-BR) through hand-written maps. LATAM Bank serves Brazilian customers and part
of the support team works in Portuguese. The user decided that the **platform UI** (analyst, Supervisión,
Administración, sign-in and onboarding) must be available in **es** and **pt-BR**, chosen by each person and
kept on her profile. Chat content is never translated; the simulator keeps following the customer.

The work has to be split: a foundation first, then several people (agents) migrating one area each in
parallel, without editing the same files.

## Decision

1. **Library: i18next + react-i18next.** The most used React i18n stack, with first-class TypeScript key
   checking (`CustomTypeOptions`: a missing key or a wrong interpolation value is a compile error), CLDR plural
   rules through `Intl.PluralRules` (`_one` / `_other`), namespaces, a pluggable lazy loader, `getFixedT` for a
   language that is not the UI's (the simulator), and a global instance usable from pure modules (`i18n.t`,
   read at call time). Alternatives: FormatJS / react-intl (ICU messages are richer than we need, keys are not
   type-checked without extra tooling, no namespaces); Lingui (compile step and macros, catalogs as `.po`);
   a hand-made dictionary (no plurals, no lazy loading, no tooling).
2. **Catalogs as TypeScript, one namespace per area.** `src/locales/<locale>/<namespace>.ts`; Spanish is the
   source (`as const`, so interpolations are typed), Portuguese ends with `satisfies Translation<typeof es>`, so
   a key missing from (or only in) the translation does not compile; a test also compares keys and placeholders.
   One namespace per area (`common`, `shell`, `auth`, `onboarding`, `home`, `cases`, `conversation`, `copilot`,
   `workspace`, `supervision`, `audit`, `admin`, `notifications`, `customer`) so the 23b agents never edit the
   same catalog. No fallback language: a gap can only be a bug.
3. **Loading.** `common` and `shell` (both locales, a few kB) are in the entry chunk: every screen needs them
   before anything renders, and a language switch is then instant for the frame. The other namespaces are lazy
   chunks per locale, loaded on first use (react-i18next suspends; the layouts have a `Suspense` boundary) and
   prefetched in the background after the first paint.
4. **One formatting layer.** `lib/format.ts` reads the active locale (`lib/i18n/locale.ts`, an external store
   that i18next updates) and formats with `Intl` (numbers, the viewer's zone) plus short per-locale word tables
   for the canvas' compact forms ("5 mar 2025", "hace 5 min" / "há 5 min"), which `Intl` does not print. Spanish
   output is unchanged. `{{count, number}}` in a catalog uses the same number format.
5. **The preference lives on the profile, apart from `Staff`.** `StaffPreferences` (`staff_preferences`,
   `uiLanguage`: `es` | `pt-BR`, default `es`) is its own aggregate: administration edits `Staff` with an
   expected version, and a person changing her own language must never make that edit stale. It is in
   `GET /auth/me`, changed with `PUT /me/preferences`, audited (`staff.ui_language_changed`, family "Accesos",
   like her other self changes) and pushed to her other sessions (`preferences.updated` on `staff:<id>`). The
   server can read it (`ui_language_of`) for the texts it renders, which 23c translates.
6. **Before sign-in**: the language this browser last used (`localStorage`, written on every pick and from the
   profile), else the browser's language when it is Spanish or Portuguese, else Spanish. `<html lang>` follows.
7. **Language names keep their own name** ("Español", "Português") in every UI language.
8. **Guard rail.** A test parses every source file and fails on UI copy outside the catalogs (JSX text, prose-like
   strings in `.tsx`, accented strings in `.ts`), with an allow-list of the areas 23b has not migrated yet; it also
   fails while the allow-list names an area with nothing left, so the list shrinks as areas land.

## Consequences

- Every new string goes to a catalog in both languages; the compiler and the tests say when one is missing.
- The startup JavaScript grows by about 64 kB (20 kB gzip): i18next, react-i18next and the two eager
  namespaces. Feature catalogs stay out of the entry chunk.
- Pure model code may call `i18n.t` at call time; components use `useTranslation` so they re-render on a
  switch. A component that only formats values reads `useActiveLocale()`.
- Server-rendered texts (audit descriptions, notifications, problem details, emails) stay Spanish until 23c.
- A local database created before 23a lacks `staff_preferences`: delete it (no migrations yet, as before).

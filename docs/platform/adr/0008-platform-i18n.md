# ADR 0008 · Platform UI in Spanish and Brazilian Portuguese

- Status: **Accepted** (user decision of 2026-10-04). 23a (the foundation), 23b (the areas, with a
  Portuguese e2e walk) and 23c (server-rendered texts, decision 9) are built: contract `api/slice-23-i18n.md`.
- Date: 2026-10-04
- Scope: `frontend/` (the staff app and, without changing its behaviour, the customer simulator), `backend/`
  (the preference; the texts it renders, 23c).
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

9. **Server-rendered texts (23c): the server renders what only it reads or sends; what many viewers see at
   once carries facts.**
   - The **audit's descriptions** and the **emails** stay rendered by the server, now in the reader's (or the
     recipient's) UI language, from one catalog module per language (`application/i18n/es.py`, the source, and
     `pt_br.py`; flat keys, `str.format` placeholders, `_one` / `_other` plurals; a test compares keys and
     placeholders, like the frontend's). Why not structured facts for the SPA here: the audit catalog has about
     a hundred event types whose sentences depend on lookups the server already batches (names, the case
     language), plurals and lists; moving that logic to the client would duplicate the catalog (families,
     "changes something") and every API consumer would need it. The log is read on demand over REST, so the
     server knows its reader (`ui_language_of`); the SPA refetches it when her language is saved. An email has
     no client at all.
   - The **staff-only transcript lines** carry their facts instead (`Turn.staffLine`: a kind and its parameters,
     stored with the turn next to the unchanged Spanish `text`), and the SPA writes them from its catalogs. Why
     not server rendering here: a new line is pushed once on the shared `case:<id>` topic to everyone watching
     the case (the assignee, supervision, another tab in another language); rendering per viewer would need a
     language-aware socket hub or a topic per language. Facts also switch language instantly without refetching
     the transcript, which is how notifications already work (the API sends a kind, the SPA writes the copy).
     Lines stored before 23c have no facts and show their text.
   - **The invitee's language** is chosen by administration when it invites her (default Spanish) and stored as
     her preference, the one place every later email and her first sign-in read; the link checks return it so
     the activation screens open in it.
   - **Problem details stay Spanish**: the SPA never shows them (it maps each `code` to its own copy), they are
     developer-facing, and translating ~180 raise sites (plus a language for anonymous requests) is not worth it
     now.

## Consequences

- Every new string goes to a catalog in both languages; the compiler and the tests say when one is missing.
- The startup JavaScript grows by about 64 kB (20 kB gzip): i18next, react-i18next and the two eager
  namespaces. Feature catalogs stay out of the entry chunk.
- Pure model code may call `i18n.t` at call time; components use `useTranslation` so they re-render on a
  switch. A component that only formats values reads `useActiveLocale()`.
- Since 23c the audit descriptions, the staff-only transcript lines and the emails follow the person's
  language; problem details stay Spanish (decision 9). A new server sentence goes to both server catalogs; a new
  kind of staff-only line adds a `StaffLineKind`, its builder in `cases/staff_lines.py` and its sentence in the
  `conversation` catalogs (both languages).
- A local database created before 23c lacks `turns.staff_line`: delete it.
- A local database created before 23a lacks `staff_preferences`: delete it (no migrations yet, as before).

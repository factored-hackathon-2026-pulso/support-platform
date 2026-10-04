# Plataforma de soporte · frontend

React SPA of the LATAM Bank support platform: the staff Workspace (Analista, Supervisión,
Administración, combinable roles with a role switcher) that talks with customers by chat, plus
the customer chat simulator used for demos. Vite, React 19, TypeScript (strict), Tailwind v4,
React Router (data router), TanStack Query, `openapi-fetch` with types generated from the
backend's OpenAPI.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before adding code (folders, feature-slice import
rules, routing, data layer, session, realtime, tokens, component catalog, testing, e2e) and
`../docs/platform/ENGINEERING_BRIEF.md` for the product rules. How to run the whole platform,
the seeded accounts and troubleshooting are in `../docs/platform/RUNBOOK.md`.

## Run

Needs Node 22 and pnpm 10, and the backend running (`cd ../backend && uv run cc-api`).

```bash
pnpm install
pnpm dev                     # http://localhost:5173
```

`VITE_API_URL` (default `http://localhost:8000`) points at the API; the realtime socket uses the
same origin. Override it in `.env.local` (template `.env.example`) or inline:
`VITE_API_URL=http://localhost:8100 pnpm dev --port 5180 --strictPort`. The SPA origin must be
listed in the backend's `CC_CORS_ORIGINS`.

| Path                                                                                                                          | Screen                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/login`                                                                                                                      | sign-in, MFA (`000000` in dev), lockout                            |
| `/analista`                                                                                                                   | "Casos": inbox + conversation                                      |
| `/supervision/colas`, `/supervision/equipo`, `/supervision/escalados`, `/supervision/casos/:caseId`, `/supervision/auditoria` | Colas (landing), Equipo, Escalados, read-only case view, Auditoría |
| `/administracion/usuarios`, `/administracion/equipos`, `/administracion/auditoria`                                            | Usuarios y roles, Equipos, Auditoría                               |
| `/cliente`                                                                                                                    | customer chat simulator (dev/demo tool, outside the staff shell)   |

Each browser tab keeps its own session (`sessionStorage`), so one tab per person.

## Scripts

| Script                                     | What it does                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm preview` | dev server · type-check + production build into `dist/` · serve the build                   |
| `pnpm typecheck`                           | `tsc -b`                                                                                    |
| `pnpm lint`                                | oxlint                                                                                      |
| `pnpm test` / `pnpm test:watch`            | Vitest + Testing Library (jsdom)                                                            |
| `pnpm format` / `pnpm format:check`        | Prettier                                                                                    |
| `pnpm gen:api` / `pnpm check:api`          | regenerate `src/lib/api/schema.gen.ts` from `../backend/openapi.json` · fail if it is stale |
| `pnpm e2e:install`                         | download Chromium for Playwright (once)                                                     |
| `pnpm e2e`                                 | Playwright scenarios in `e2e/`                                                              |

Quality gates (all must pass): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
`pnpm format:check`, `pnpm check:api`.

After any API change: `cd ../backend && uv run python -m cc_platform.scripts.export_openapi`,
then `pnpm gen:api`.

`pnpm e2e` starts its own backend (on a fresh temporary SQLite database) and its own Vite on
free ports; it never touches `backend/cc_platform.db` and does not need the app running. See
`playwright.config.ts` and ARCHITECTURE.md §10.

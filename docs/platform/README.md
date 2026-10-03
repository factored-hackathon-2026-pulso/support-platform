# Support platform · engineering docs

Start with the brief; everything else hangs off it.

| Document | What it is for |
|---|---|
| [ENGINEERING_BRIEF.md](./ENGINEERING_BRIEF.md) | Scope (chat-only support platform), stack, layout, patterns, product rules, slice plan, quality gates, hygiene. Every slice and review follows it. |
| [adr/0001-architecture.md](./adr/0001-architecture.md) | Hexagonal + DDD-lite + CQRS-lite with an append-only event log; patterns table, alternatives, consequences. |
| [adr/0002-ai-ui-frameworks.md](./adr/0002-ai-ui-frameworks.md) | **Superseded (2026-10-03):** AI is out of the platform scope. Kept only as a record; do not implement it. |
| [api/slice-1-cases.md](./api/slice-1-cases.md) | Slice 1 API contract (implemented): cases, turns, assignment, inbox, customer simulator, realtime topics, seed. Partly superseded by slice 2. |
| [api/slice-2-case-lifecycle.md](./api/slice-2-case-lifecycle.md) | Slice 2 contract: the scope-cut removal list, the case lifecycle (statuses, close with a reason, new case after a close, case history, first-response SLA), REST + realtime changes, seed, frontend changes. |
| [api/slice-3-supervision.md](./api/slice-3-supervision.md) | Slice 3 contract: team and queues read models, manual assignment and reassignment (rule 3, paused confirmation, CAS rules), supervisor read-only case view (audited), audit queries and catalog, supervision realtime topics, seed, frontend screens. |
| [../../backend/README.md](../../backend/README.md) | API: run, seeded sign-in accounts, conventions, gates, known gaps. |
| [../../frontend/README.md](../../frontend/README.md), [../../frontend/ARCHITECTURE.md](../../frontend/ARCHITECTURE.md) | SPA: run, folder and slice rules, routing, components, data layer, realtime, testing. |

Other sources of truth: design boards in `warehouse/design/source/project/*.dc.html`
(read-only; only the screens still in scope apply, see brief §2), rule 3 (language) in
`docs/policies.md`, and the event envelope of `contracts/platform_history.json` (read-only).
`docs/security_questions.md` and the abono, approval and automation rules of
`docs/policies.md` no longer apply to the platform.

New architecture decisions go in `adr/NNNN-title.md` (next number: 0003).

## Run backend and frontend together

Requirements: [uv](https://docs.astral.sh/uv/) (installs Python 3.12), Node 22 and pnpm 10.

```bash
# terminal 1 · API on http://127.0.0.1:8000 (seeds demo staff into backend/cc_platform.db)
cd backend
uv sync
uv run cc-api

# terminal 2 · SPA on http://localhost:5173
cd frontend
pnpm install
cp .env.example .env.local    # VITE_API_URL=http://localhost:8000 (the default)
pnpm dev
```

- Sign in at http://localhost:5173/login with a seeded account, e.g.
  `daniela.rios@latambank.example` / `demo1234`, then MFA code `000000`. All accounts are in
  the backend README ("Datos de ejemplo", invented people).
- CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` (`CC_CORS_ORIGINS`). The
  realtime socket follows the API origin: `ws://localhost:8000/api/v1/ws?token=…`.
- Reset data: stop the API and delete `backend/cc_platform.db`, or run it with
  `CC_PERSISTENCE=memory`.
- API docs: http://127.0.0.1:8000/api/v1/docs.

## Keep the contract in sync

OpenAPI is the contract between the two apps.

```bash
cd backend && uv run python -m cc_platform.scripts.export_openapi   # writes backend/openapi.json
cd frontend && pnpm gen:api                                          # writes src/lib/api/schema.gen.ts
```

Both have a check mode (`export_openapi --check`, `pnpm check:api`) that fails when the
committed file is stale; the backend check also runs inside `pytest`.

## Quality gates (brief §6)

```bash
cd backend  && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q
cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check
```

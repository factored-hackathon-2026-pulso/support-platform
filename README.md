# Support platform

Support platform for LATAM Bank's transaction-dispute intake (Factored AI & Data Hackathon 2026). Customers and support staff talk by chat and by simulated phone calls and email; analysts handle cases, supervisors watch queues, team and escalations, and administrators manage users by email invitation. People only: no AI is connected yet.

The product UI is in Spanish and, since slice 23, Brazilian Portuguese (each person picks it in the account menu); the implementation is in English.

## Layout

| Path | What it is |
|---|---|
| `backend/` | Python 3.12 API (FastAPI, hexagonal architecture, event log, realtime over WebSocket). See `backend/README.md`. |
| `frontend/` | React 19 + Vite SPA, feature-sliced, types generated from the API's OpenAPI. See `frontend/README.md` and `frontend/ARCHITECTURE.md`. |
| `docs/platform/` | Engineering brief, data model, run book, ADRs and one API contract per slice. Start at `docs/platform/README.md`. |
| `docker-compose.yml` | Runs the API and the web app together. |

## Run it

```sh
docker compose up -d --build
```

Web app on http://localhost:5173, API on http://localhost:8000. Seeded accounts, the dev mailbox for invitations and running without Docker are in `docs/platform/RUNBOOK.md`.

## Quality gates

Backend (`cd backend`): `uv run ruff check .` · `uv run ruff format --check .` · `uv run mypy src` · `uv run pytest -q`.
Frontend (`cd frontend`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm format:check` · `pnpm check:api` · `pnpm e2e`.

## Related repo

`data-lab` holds the data side: ingestion and quality of the challenge dataset, its contracts, the synthetic sample shared with the AI team, and the business policies.

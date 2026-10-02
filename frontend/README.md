# Plataforma de soporte · frontend

React SPA for the LATAM Bank contact-center staff (analista, supervisora,
automatización, administración) plus a customer chat simulator for demos.

```bash
pnpm install
cp .env.example .env.local   # VITE_API_URL, default http://localhost:8000
pnpm dev                     # http://localhost:5173
```

Quality gates (all must pass): `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm build`, `pnpm format:check`.

API types are generated from `../backend/openapi.json` into
`src/lib/api/schema.gen.ts`: `pnpm gen:api` regenerates them, `pnpm check:api`
fails when they are stale.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before adding code, and
`../docs/platform/ENGINEERING_BRIEF.md` for the product rules.

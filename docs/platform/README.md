# Support platform · docs index

LATAM Bank **support platform**: support staff and customers talk **by chat**, end to end,
person to person. A customer writes from the app or the web (the customer chat simulator stands
in for both); the case goes to an available analyst who speaks the customer's language (rule 3);
they talk until the analyst closes the case with a reason; if the customer writes again, a new
case opens, linked to the previous one. Supervision watches the team and the language queues,
assigns and reassigns cases, and reads the audit log. Administration manages people, roles,
languages and teams.

Roles combine (one person can hold several and switch between them):

| Role | Screens |
|---|---|
| Analista | "Casos": the inbox (Nuevos · Por responder · Esperando al cliente · Cerrados) and the live conversation |
| Supervisión | "Colas" (every open case by language; assignment is automatic), "Equipo" (analysts, reassignment as the exception), "Escalados" (answer, take, reassign), read-only case view, "Auditoría" |
| Every role | The bell in the rail: her notifications ("Nuevas" / "Anteriores"), live toasts with "Más tarde" (slice 10) |
| Administración | "Usuarios y roles", "Equipos", "Auditoría" |

Out of scope and not built anywhere: AI of any kind, a tool catalog or actions on bank systems,
customer or bank data, identity checks, approvals, automation, calls, email, analyst-to-analyst
transfers, the customer mobile app (only the simulator exists), core-banking integration and
CSAT. The full list is in the brief §1.

Every person, customer and case in the seed is invented ("Datos de ejemplo").

## Documents

| Document | Language | What it is for |
|---|---|---|
| [ENGINEERING_BRIEF.md](./ENGINEERING_BRIEF.md) | English | Start here. Scope, stack, layout, patterns, product rules, API conventions, slice plan, quality gates, hygiene. Every slice and review follows it. |
| [RUNBOOK.md](./RUNBOOK.md) | Spanish | Install, run backend + frontend, environment variables, seeded accounts and simulator customers, database reset, API type regeneration, gates, e2e, troubleshooting. |
| [DEMO.md](./DEMO.md) | Spanish | 7–10 minute demo script for judges (three browser windows), with recovery steps. |
| [DATA_MODEL.md](./DATA_MODEL.md) | Spanish | Tables, case life cycle, event log, and how the platform differs from the synthetic sample contract. |
| [adr/0001-architecture.md](./adr/0001-architecture.md) | English | Hexagonal + DDD-lite + CQRS-lite with an append-only event log; patterns, alternatives, consequences (amended 2026-10-03 for the scope cut). |
| [adr/0002-ai-ui-frameworks.md](./adr/0002-ai-ui-frameworks.md) | English | **Superseded (2026-10-03).** Kept only as a record; do not implement it. |
| [api/slice-1-cases.md](./api/slice-1-cases.md) | English | Slice 1 contract (live chat, inbox, simulator). **Partly superseded** by slice 2; kept as the record. |
| [api/slice-2-case-lifecycle.md](./api/slice-2-case-lifecycle.md) | English | Slice 2: the scope-cut removal list and the case life cycle (statuses, close with a reason, linked case after a close, case history, first-response SLA, `AssignCase`), seed. |
| [api/slice-3-supervision.md](./api/slice-3-supervision.md) | English | Slice 3: team and queues, manual assignment and reassignment (rule 3, paused confirmation), supervisor case view, audit queries, supervision realtime topics. |
| [api/slice-4-administration.md](./api/slice-4-administration.md) | English | Slice 4: users, combinable roles, languages, teams, lock/unlock, password reset, guard rails, admin realtime, audit texts. |
| [api/slice-5-e2e.md](./api/slice-5-e2e.md) | English | Slice 5: the Playwright browser e2e (scenarios mapped to the brief, fresh temp database and free ports, one worker, fixtures and customer reservation, how to add a scenario), the `writeInbox` fix, known gaps, hand-over docs. |
| [api/slice-8-priority.md](./api/slice-8-priority.md) | English | Slice 8 (part 1): case priority (none to critical), who may change it, `expectedVersion`, audit and realtime, the fixed 15-minute SLA, the priority glyphs and menu, ratings with less text. |
| [api/slice-9-supervision-v2.md](./api/slice-9-supervision-v2.md) | English | Slice 9: supervision v2 (Colas with every open case by language, Equipo as one table with filters, the reassign dialog), escalations to supervision (analyst and supervisor sides), the "Filtros" dropdown, gender-neutral roles, the admin users filters. |
| [api/slice-10-notifications.md](./api/slice-10-notifications.md) | English | Slice 10: the notification center (persisted per person, derived from the event log and the SLA sweep, kinds and recipients, the three routes, `staff:` envelopes, the bell, panel and toasts with "Más tarde"), plus the part-2 leftovers. |
| [api/slice-11-invitations.md](./api/slice-11-invitations.md) | English | Slice 11 (part 4): secure onboarding by email invitation (no temporary passwords: invitations and reset links by email, the person's own password and TOTP authenticator, the public `/onboarding/*` routes, the dev mailbox, the audit texts and the seed). |
| [../../backend/README.md](../../backend/README.md) | English | API: run, layout, endpoint map, conventions, realtime, concurrency, gates, known gaps. |
| [../../frontend/README.md](../../frontend/README.md), [../../frontend/ARCHITECTURE.md](../../frontend/ARCHITECTURE.md) | English | SPA: run, scripts, folder and import rules, routing, data layer, realtime, testing, e2e. |

Where contracts disagree, the later slice wins, and the brief wins over all of them.

Other sources of truth: the design boards in `warehouse/design/source/project/*.dc.html`
(read-only; only the screens still in scope apply, brief §2), rule 3 (language, policy `H1`) in
`docs/policies.md`, and the event envelope of `contracts/synthetic-sample/platform_history.json` (read-only). The
other rules of `docs/policies.md` and `docs/security_questions.md` do not apply to the platform.

New architecture decisions go in `adr/NNNN-title.md` (next number: 0003).

## Quick start

```bash
cd backend  && uv sync && uv run cc-api        # API on http://127.0.0.1:8000, seeds the demo data
cd frontend && pnpm install && pnpm dev        # SPA on http://localhost:5173
```

Sign in at http://localhost:5173/login as `daniela.rios@latambank.example` / `demo1234`, MFA
code `000000`; the customer simulator is at http://localhost:5173/cliente. Everything else
(other accounts, reset, gates, e2e, troubleshooting) is in [RUNBOOK.md](./RUNBOOK.md).

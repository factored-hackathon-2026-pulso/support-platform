# Slice 5 contract · browser e2e and hand-over docs

**Status:** implemented (2026-10-03). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-03.

**Scope.** The last slice of a **people-only** chat support platform (brief §8, S5):

1. **Browser e2e**: Playwright scenarios in Chromium over the real stack (FastAPI backend on a fresh database + the Vite dev server), several browser windows per scenario, one per person. They cover the seven flows the brief names, plus two live admin effects.
2. **Hand-over docs**: final `backend/README.md`, `frontend/README.md` + `frontend/ARCHITECTURE.md` §10, `../RUNBOOK.md` (Spanish run book) and `../DEMO.md` (Spanish demo script for judges).

This slice adds no endpoint, schema, event, table or screen. `openapi.json` and `schema.gen.ts` are unchanged. The only app change is the bug fix the suite exposed (§6).

Not in this slice (and not built anywhere): AI, agents, copilot, tools, customer or bank data, identity checks, approvals, automation, calls, email, visual regression or screenshot diffs, load or performance tests, cross-browser runs (Firefox/WebKit), a CI pipeline definition.

Read first:
- `../ENGINEERING_BRIEF.md` (it wins over this file), §6 (the e2e gate) and §8;
- `slice-2-case-lifecycle.md`, `slice-3-supervision.md`, `slice-4-administration.md`: the behaviour under test (this file changes none of it);
- `frontend/ARCHITECTURE.md` §10 "Browser e2e": the code-level rules (page objects, locators, fixtures).

---

## 1. How to run

```bash
cd frontend
pnpm e2e:install                 # once: Chromium for Playwright
pnpm e2e                         # the whole suite (8 scenarios, ~30 s)
pnpm e2e e2e/auth.spec.ts        # one file
pnpm e2e -g "Casos anteriores"   # by title
pnpm e2e --repeat-each=2         # every scenario twice on the same database
pnpm e2e --headed                # or --ui, to watch it
```

Nothing has to be running. `backend/cc_platform.db` is never read or written. Traces and screenshots are kept on failure in `frontend/test-results/`; with `CI` set, the HTML report goes to `frontend/playwright-report/` (both git-ignored).

## 2. Harness (`frontend/playwright.config.ts`)

| Piece | Rule |
|---|---|
| **Ports** | The first evaluation of the config (runner main process) asks the OS for **two free ports** (`net.createServer().listen(0)`) and a temp directory name, and exports them as `E2E_API_PORT`, `E2E_WEB_PORT` and `E2E_DATA_DIR`. Workers inherit `process.env`, so every process agrees on one backend and one SPA. `e2e/support/env.ts` exposes `API_URL` and `WEB_URL` and fails fast outside `pnpm e2e`. |
| **Backend** | `webServer` "api": `mkdir -p <dataDir> && uv run uvicorn cc_platform.bootstrap.app:create_app --factory --host 127.0.0.1 --port <api>` in `../backend`, with `CC_ENV=test` (no reload), `CC_PERSISTENCE=sqlalchemy`, `CC_DATABASE_URL=sqlite+aiosqlite:///<os tmp>/cc-e2e-<pid>-<time>/cc_platform.db` (a **fresh** database, so the seed's clock starts with the run), `CC_SEED_DEMO_DATA=true`, `CC_CORS_ORIGINS=[<web origin>]`. Ready when `/api/v1/health` answers. `reuseExistingServer: false`: the suite never attaches to a dev server. |
| **SPA** | `webServer` "web": `pnpm exec vite --host 127.0.0.1 --port <web> --strictPort` with `VITE_API_URL=<api origin>`. |
| **Teardown** | `e2e/support/global-teardown.ts` deletes the data directory, and only if it is a `cc-e2e-*` directory directly under the OS temp dir. |
| **Browser** | One project, Chromium, desktop viewport **1440×900** (brief §5.4), `locale: es-CO`, `timezoneId: America/Bogota`. |
| **Timeouts** | Test 90 s, `expect` 10 s, action 10 s, navigation 20 s, each web server 120 s to boot. |
| **Retries** | 0 locally, 1 with `CI` (`forbidOnly` with `CI`). |
| **Workers** | **1**, `fullyParallel: false` (§4). |

## 3. Scenarios

Every brief bullet maps to one test; two more cover live admin effects that would otherwise only have unit tests.

| Brief §8 S5 bullet | Test (`frontend/e2e/…`) | What it proves |
|---|---|---|
| two-window chat | `chat.spec.ts` "two windows talk live both ways and a reload keeps the order" | A new es analyst becomes available. The customer writes and gets her ("Te atiende {nombre}"), live in the analyst list as "Nuevo". Analyst → customer and customer → analyst arrive live with no reload, and the card moves to "Por responder". Both transcripts keep the same order, and still do after reloading both windows. |
| close and a new linked case | `chat.spec.ts` "closing with a reason, then a new linked case and "Casos anteriores"" | Close with "Resuelto" + a note. The customer sees the closing notice and "ended", **never** the reason or the note. The case leaves "Todos" and appears under "Cerrados", read-only (no composer, no "Cerrar caso"). Writing again opens a **new** case for the same analyst, tagged "Volvió a escribir", without the old turns. |
| "Casos anteriores" | same test | "Casos anteriores (n)" opens the sheet with n rows. The row this test closed ("Resuelto · {analista}") shows its read-only transcript and "Nota: …". The customer's side lists the closed conversation under past conversations after a reload. |
| queue and drain | `supervision.spec.ts` "a case nobody eligible can take waits in its queue and drains to the first eligible analyst" | A pt customer writes while only an es analyst is available. The case waits ("searching"), shows up live in "Cola en portugués" with its text, and never reaches the es analyst (rule 3). A pt analyst becomes available, the queue drains to her live, and the customer sees her name. |
| supervisor assignment and reassignment | `supervision.spec.ts` "a supervisor assigns a queued case and reassigns it while the analyst watches (rule 3 in the dialog)" | In the assign dialog the es-only analyst is disabled with the description "No habla portugués (regla 3)". Lucía assigns to a **paused** es+pt analyst with the paused confirmation; the analyst gets the card and the toasts "Te asignaron un caso" / "{cliente} · desde supervisión", and the customer sees her. Lucía reassigns from the supervisor case view to a pt analyst; the customer notice "Agora quem te atende é {nombre}, da nossa equipe." shows in the dialog and in the chat. The first analyst watches the card leave and gets "Supervisión reasignó un caso". The new assignee sees the transcript. |
| admin invites an analyst, who then receives a case | `admin.spec.ts` (slice 11, part 4: replaces the temporary-password scenario) | Valeria invites the person through "Usuarios y roles" ("Enviar invitación", "Invitación enviada a …", row "Invitación pendiente"). A second window opens the dev mailbox (`/dev/correos`), follows the invitation link, sets a password (live rules), reads the manual key and computes the TOTP code in the test, activates the account ("Tu cuenta está lista"), signs in with password + TOTP, becomes available and receives the next customer's case live. Helper-created people are invited and activated through the API the same way (`e2e/support/api.ts`, `e2e/support/totp.ts`). |
| lockout and unlock | `auth.spec.ts` "five wrong passwords lock the account until an admin unlocks it" | "Te quedan 4 … 1 intento" and the password field cleared each time. The fifth attempt goes to `/login/bloqueada` ("Tu cuenta está bloqueada por 15 minutos" + the countdown `timer`). The right password is refused while locked. Valeria sees "Bloqueada", unlocks ("Cuenta desbloqueada", the row reads "Activa"), and the person signs in. |
| (extra) role change live | `admin.spec.ts` "a role change shows up live in the role switcher of the signed-in person" | Adding Supervisora → "Cambiaron tus roles" / "Ahora tienes: Analista y Supervisora." and the switcher offers it with no new sign-in (socket 4409 + `me.updated`). Removing it while she is on "Equipo y colas" moves her back to `/analista`. |
| (extra) deactivation | `admin.spec.ts` "deactivating an account signs that person out of her open window" | Her open window goes to `/login` live (socket 4401), and her credentials are refused afterwards. |

## 4. Fixtures and isolation rules (`frontend/e2e/support/`)

The backend is shared by the whole run, and assignment depends on **who is available** (rule 3, then the least loaded). The rules below keep one scenario from changing what the next one sees, so the suite passes in any order, on a retry and with `--repeat-each`.

- **One worker.** Two scenarios running at once would compete for the same available analysts and queues (a case meant for one scenario's analyst would go to another's). The cost is a ~30 s run, which is accepted.
- **`actors`**: one browser **context** per person (its own `sessionStorage`, so its own session): `open`, `signedIn` (UI password + MFA), `customer` (the simulator as a given customer). An uncaught `pageerror` in **any** window fails the test, even when its assertions passed.
- **`people`**: every analyst who works cases is **created by the scenario** through the admin API (`POST /admin/users`, Equipo Andes, unique invented name and `e2e.*@latambank.example` email, rotating first names so "Asignar a {nombre}" is unambiguous). They start "En pausa". In teardown each one is paused again (`pauseQuietly`, best effort), so nobody a scenario made available takes the next scenario's cases. `adopt` registers a person created through the UI.
- **Seeded staff are never changed.** Only Lucía Herrera (supervisor) and Valeria Quintero (admin) are used, to sign in and act. Seeded analysts stay paused, which keeps the seeded queues and loads out of the way.
- **`customers.release(customer)`**, the **customer reservation rule**: before writing as a simulator customer, the scenario asks for her with **no open conversation**. If one is open (left by the seed or by an earlier attempt of the same scenario), supervision assigns it to the worker's **janitor** (a paused es+pt analyst created once per worker, with `confirmPaused`) and the janitor closes it with reason `other`. The call returns her closed-conversation count, which the "Casos anteriores (n)" assertion uses.
- **One customer per scenario** (`data.ts` `CUSTOMERS`), so two scenarios never write as the same person:

  | Customer (seed id) | Language | Used by |
  |---|---|---|
  | Natalia Guzmán Rincón (`CUS-…2001`) | es | chat: two windows |
  | Ximena Robles Treviño (`CUS-…2002`) | es | chat: close, linked case, "Casos anteriores" |
  | Rafael Nogueira Costa (`CUS-…2004`) | pt | supervision: queue and drain |
  | Gabriela Duarte Melo (`CUS-…1008`) | pt | supervision: assign and reassign (her seeded queued case 109 is released first) |
  | Andrés Felipe Cardona (`CUS-…2005`) | es | admin: new analyst receives a case |
  | Lucas Benítez Sosa (`CUS-…2003`) | es | free (the next new scenario takes it) |

- **Assertions.** Locators are roles and accessible names (no CSS selectors, no test ids). Assertions are web-first (`expect(locator)…`), with no sleeps and no `waitForTimeout`. Every message text comes from `uniqueText()`, so an assertion never matches an older turn of the same customer. REST (`api.ts`) is used only for setup and cleanup, never as the thing under test.
- **A failing scenario never gets a weaker assertion.** If it exposes a product bug, the fix and a unit test go in the app (§6).

## 5. Adding a scenario

1. Take a customer nobody uses (today: Lucas). If none is left, add a simulator customer to the backend seed (an invented person) and to `CUSTOMERS`, and call `customers.release` first.
2. Create the analysts it needs with `people.analyst([...])`. Never sign in as a seeded analyst to work cases, and never change Lucía or Valeria.
3. Leave nobody available: `people` pauses its own people, but a person made available through another path must be `adopt`ed.
4. Use page objects in `e2e/support/pages/` (extend them rather than locating in the spec).
5. Prove it is isolated: `pnpm e2e --repeat-each=2` on one run must pass.

## 6. Bug found and fixed: `writeInbox` (`frontend/src/features/cases/realtime.ts`)

**Symptom** (close-and-linked-case scenario). The analyst opens the "Cerrados" filter after a close, and the customer writes again. Back on "Todos", the counters show the new case but its card is missing, and it stays missing for the query's `staleTime`.

**Cause.** The new case's `case.assigned` correctly invalidated the off-screen "Todos" inbox (it does not refetch while inactive). The next `inbox.counts` (or a card patch) wrote the inbox with `setQueryData`. In TanStack Query v5 that marks the query fresh and clears `isInvalidated`, so the pending refetch was lost.

**Fix.** Every patched inbox goes through `writeInbox`. It remembers whether the query was invalidated and, after `setQueryData`, invalidates it again with `refetchType: 'none'`. No request is sent now, and the refetch runs when that filter is shown. Unit test: `src/features/cases/realtime.test.ts`, "an inbox off screen keeps its pending refetch through later counts and card patches".

## 7. Hand-over docs (delivered in this slice)

| Document | Content |
|---|---|
| `../RUNBOOK.md` (es) | Requirements, install, run both apps, other ports, environment variables, seeded accounts, cases and simulator customers, database reset, API type regeneration, gates, e2e, troubleshooting (ports, `OutdatedSchemaError`, no connection, locked account, WebSocket 4401/4409). |
| `../DEMO.md` (es) | 7–10 minute script for judges (three windows + a tab for the new person), what to say and what to point at, recovery table. |
| `backend/README.md`, `frontend/README.md`, `frontend/ARCHITECTURE.md` §10 | Run, layout, gates, e2e harness and rules. |
| `../README.md` | Index of every document (this contract included). |

## 8. Done

- All brief §6 gates pass (backend and frontend), and `pnpm e2e` passes: 8/8 on a fresh database.
- The suite passes with `--repeat-each=2` (16/16 on one database), and file or title subsets pass on their own.
- No uncaught page error in any window.
- DEMO.md was rehearsed end to end on a fresh database. Step 9.3 (lockout and unlock) locks Martín Salazar live, because Mariana Duque's seeded lock can end before the script reaches it.

## 9. Known gaps (do not build now)

- **Free-port race.** The config probes a port, closes the probe, then the web server binds it a moment later. Another process can take it in between; the run then fails at boot (`address already in use` or Vite `--strictPort`). Re-run it.
- **Fixed customer list.** The simulator customers are seeded and reserved per scenario (§4); only Lucas is left. More scenarios need more seeded customers. The janitor's closes stay in each customer's history for the rest of the run (the temp database is dropped at the end).
- **Time-based behaviour is not exercised.** Not covered: the 15-minute lockout expiry (only the admin unlock is), first-response SLA turning "en riesgo"/"vencido", the 7-day "Cerrados" window, session and MFA expiry. Backend tests inject their own `Clock`, but the running server always uses `SystemClock`, and no setting exposes a controllable one.
- **Not covered in the browser** (unit/API tests only): audit screens and filters, the teams screen, password reset, self guards and the last-admin rule, `version_conflict`, deactivation blocked by open cases.
- **One browser, one size.** Chromium at 1440×900 only. The 1280 check is the Playwright smoke of S3/S4, not part of the suite. No Firefox or WebKit.
- **One worker.** The suite cannot be sharded or run in parallel against one backend (§4).
- **Interrupted runs.** If the runner is killed before `globalTeardown`, a `cc-e2e-*` directory may remain under the OS temp dir. It is safe to delete.

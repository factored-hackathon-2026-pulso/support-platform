# Slice 4 contract · administration

**Status:** implemented (2026-10-03). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-03.

> **Superseded in part by `slice-11-invitations.md` (part 4, 2026-10-04).** There are no
> temporary passwords any more: `POST /admin/users` invites the person by email (`InvitedUser`,
> no password), `POST /admin/users/{id}/password-reset` emails a reset link
> (`PasswordResetLinkSent`), `TemporaryPasswordGenerator`, `CreatedUser`, `PasswordResetResult`,
> `temporaryPassword` and `TemporaryPasswordDialog` are gone, and `staff.password_reset` is now
> recorded by the person herself. Everything about temporary passwords below (§1.3, §3.1, §3.5,
> §3.9, §5, §10.3, §12, §13) is historical; the rest of this contract still holds.

**Scope.** Administration of a **people-only** chat support platform (brief §8, S4). Everything here is for the **Administración** role:

1. **Users**: list with filters and search, create (name, unique email, roles, languages, team; a temporary password shown once), edit, deactivate and reactivate, unlock a locked account, reset the password.
2. **Teams become records**: create, rename, deactivate and reactivate, membership. Slice 3 team slugs become team ids end to end (supervision keeps working).
3. **Guard rails**: nobody removes their own Administración role or deactivates themself; there is always at least one active admin; open cases block changes that would leave them without an eligible assignee; role changes take effect on the next request and close the person's sockets.
4. **Optimistic concurrency**: every edit carries `expectedVersion`; a stale one is `409 version_conflict` with the current data.
5. **Audit**: every change is an event with a readable Spanish description in the slice 3 catalog (new family "Administración"), visible in `/supervision/auditoria` and in a new admin entry point, `/administracion/auditoria` (the same audit feature).
6. **Realtime**: directory changes for admins; the person's own profile and roles for every staff member (the role switcher updates without signing in again).

Not in this slice (and not built anywhere): AI, agents, copilot, automation and the Automatización role, four-eyes or any approval of a change, tools and permissions, policies and rules, data retention, levels ("Nivel", "Límite de abono"), "Vacaciones"/"Licencia", customer or bank data, identity checks, calls, email, deleting people or teams, a forced password change at first sign-in, a password policy screen, per-person MFA settings, bulk actions, CSV import/export, pausing an analyst on her behalf (the only automatic pause is the side effect of §3.4/§3.3), reassigning cases from administration (that is supervision's job).

Read first:
- `../ENGINEERING_BRIEF.md` (it wins over this file);
- `../adr/0001-architecture.md`;
- `slice-2-case-lifecycle.md` and `slice-3-supervision.md` (everything there that this file does not change still holds);
- design boards (read-only): `warehouse/design/source/project/Admin.dc.html` (section `usuarios` only: list + 400 px aside, role pills with counts, role checkbox cards, "Guardar cambios"), `SuTeam.dc.html` and `SuAudit.dc.html` (density, table and aside look). Drop from Admin: the "Herramientas y permisos", "Políticas y reglas" and "Retención de datos" sections and rail items, "Automatización", "cuatro ojos", "1 cambio espera tu aprobación", "Dar el rol de Administración lo aprueba otra persona…", "NIVEL", "Límite de abono sin aprobación", "Vacaciones", country, the `service_agents` source note, "1.200 personas".

Extend the slice 0–3 foundations (UoW + event log, `retry_on_conflict`, `VersionedRepository`, the `ProblemCode` registry, `ApiContext` routers, `TopicMapper`/`TopicAccessPolicy`, `SessionTerminator`, `SupervisionRealtimeProjector`, the audit catalog, `RealtimeClient`, the handler registry, `Schemas[...]`, `QueryState`, the `features/audit` screen). Never fork them.

**Conventions** (same as slices 1–3): JSON camelCase, Python snake_case; `datetime` = ISO-8601 UTC with `Z`; `T | null` = always present, may be null; `x?` = may be absent in a request; **bold** names are Pydantic classes (`Schemas['…']` in the SPA); "team-generated" marks a value we chose.

---

## 0. Parallel-work protocol

1. **Backend, first milestone (before any logic):**
   - add the enums, schemas, problem codes and `ProblemDetails` extensions of §1, §5, §8;
   - rename `TeamRef.key`/`TeamSummary.key` to `id` and change `StaffOut.team` (§6, §5.3);
   - add the routes of §5.1 with their final signatures (they may raise `NotImplementedError`);
   - run `uv run python -m cc_platform.scripts.export_openapi`.

   From then on `backend/openapi.json` is the contract. Tell the frontend agent when it lands.
2. **Frontend:** run `pnpm gen:api` as soon as the new `openapi.json` exists, and again whenever it changes. Until then, build `model.ts`, URL state and pure components against the names in this file. Never hand-edit `schema.gen.ts`. Tests mock each feature's `api.ts`.
3. **Frozen for the slice:** field names, enum values, URL slugs, topic names, envelope types, close codes, query keys and public exports below. A change needs this file updated first.
4. **Data reset:** the SQLite schema changes (§2.6: new `teams` and `admin_roster` tables, `staff.team` → `staff.team_id`, new staff columns). Delete `backend/cc_platform.db` (or run with `CC_PERSISTENCE=memory`) after pulling this slice; say so in `backend/README.md`. `OutdatedSchemaError` must list the missing tables and columns.

---

## 1. Vocabulary

### 1.1 New enums (OpenAPI names)

| Enum | Values | Notes |
|---|---|---|
| **`AccountStatus`** | `active`, `locked`, `inactive` | Derived, never stored: `inactive` = `Staff.active` false; `locked` = active and the login account is locked **now** (`locked_until > now`); else `active`. |
| **`UserStatusFilter`** | `active`, `locked`, `inactive`, `all` | `active` = every active account, **locked ones included** (they are active accounts); `locked` = only the locked ones. Default `active`. |
| **`TeamStatusFilter`** | `active`, `inactive`, `all` | Default `active`. |
| **`SelfChangeAction`** | `remove_own_admin`, `deactivate_self`, `reset_own_password` | Extension of `self_change_forbidden` (§8). |
| **`OpenCasesBlock`** | `deactivate`, `remove_analyst`, `remove_language` | Extension of `staff_has_open_cases` (§8). |
| `AuditFamily` | + **`administration`** | §7.1. |
| `StaffRole`, `Language`, `AvailabilityStatus`, `ActorRole` | unchanged | |

### 1.2 Labels (Spanish, one source each)

| Thing | Values | Where |
|---|---|---|
| Role labels | `analyst` "Analista" · `supervisor` "Supervisora" · `admin` "Administración" | Backend `application/people/admin/copy.py` (`ROLE_LABEL`, audit descriptions); frontend `app/roles.ts` (`ROLE_LABEL`, pinned by a test to the same text; the audit kind badges already use them). |
| Role descriptions (role cards) | Analista "Atiende casos por chat con los clientes." · Supervisora "Ve el equipo y las colas, asigna y reasigna casos, y revisa la auditoría." · Administración "Crea y edita cuentas, roles, idiomas y equipos." | Frontend `model.ts` (`ROLE_DESCRIPTION`). |
| Language labels | `es` "Español" · `pt` "Portugués" (in sentences lower-case: "español", "portugués") | Backend `copy.LANGUAGE_NAME` (exists); frontend `model.ts`. |
| Account status | `active` "Activa" · `locked` "Bloqueada" · `inactive` "Desactivada" (they qualify "cuenta") | Frontend `model.ts`. |
| Team status | "Activo" · "Inactivo" | Frontend `model.ts`. |
| Lists in Spanish | "A", "A y B", "A, B y C" | Backend `copy.join_es(items)`; frontend `joinEs(items)` in `lib/format.ts` (re-exported by `features/admin/model.ts`; same rule, tested). |

### 1.3 Team-generated constants

| Constant | Value | Where |
|---|---|---|
| Temporary password | 12 characters from `abcdefghjkmnpqrstuvwxyz23456789` (no look-alikes), shown as `xxxx-xxxx-xxxx` (14 chars, the dashes are part of it) | `infrastructure/security/temporary_passwords.py` (`SecretsTemporaryPasswordGenerator`, `secrets.choice`). |
| Name length | person 2–120, team 2–80 (after trimming; inner runs of spaces collapsed to one) | Domain. |
| Email length | ≤ 254 after `normalize_email` | Domain + request schema. |
| Directory size cap | `GET /admin/users` returns at most 500 rows (team-generated; the directory is small, no pagination) | Query; documented gap. |
| Idempotency key | 8–64 chars `[A-Za-z0-9_-]` | `Idempotency-Key` header of the two creates. |

---

## 2. Domain and persistence (`people` context)

### 2.1 `Team` (new aggregate, `domain/people/team.py`)

```python
@dataclass(eq=False)
class Team(AggregateRoot):
    id: str               # TEAM-… (new IdPrefix.TEAM = "TEAM")
    name: str             # trimmed, inner spaces collapsed, 2–80
    active: bool
    created_at: datetime
    creation_key: str | None = None   # Idempotency-Key of the create (§3.9)

    @property
    def name_key(self) -> str: ...    # team_name_key(name): casefold, accents stripped, spaces collapsed

    @classmethod
    def create(cls, *, team_id, name, now, actor, creation_key=None) -> Team   # records team.created
    def rename(self, name, *, now, actor) -> bool          # False (nothing recorded) when name_key and name are unchanged
    def deactivate(self, *, active_members: int, now, actor) -> bool   # members > 0 → TeamNotEmptyError; already inactive → False
    def reactivate(self, *, now, actor) -> bool            # already active → False
    def touch(self) -> None                                # no event; makes the next save bump `version` (CAS token, §3.8)
```

Uniqueness: `name_key` is unique among **all** teams (active or not), enforced by the repository (unique column) → `TeamNameTakenError` (`team_name_taken`). A rename that only changes case or accents of the same team is allowed (same `name_key`, own row).

### 2.2 `Staff` (changed)

- `team: str` is replaced by **`team_id: str`** (`TEAM-…`, required). Every staff member, active or not, belongs to exactly one team. Admins and supervisors belong to a team too (the seed puts admins in "Administración de la plataforma").
- New fields: `created_at: datetime`, `creation_key: str | None`.
- Invariant change: languages may be empty **only** when the person does not hold `analyst` ("analysts need ≥ 1"); roles ≥ 1 (unchanged); name 2–120.
- New behaviour (each records its event with `now` and `actor`, returns `False` and records nothing when there is no change):

| Method | Event |
|---|---|
| `Staff.create(..., now, actor)` (classmethod) | `staff.created` |
| `update_profile(name=None, email=None)` | one `staff.profile_updated` for whatever changed (a name + email edit is one event) |
| `set_roles(roles)` | `staff.roles_changed` |
| `set_languages(languages)` | `staff.languages_changed` |
| `move_to(team: Team)` | `staff.team_changed` (the team must be active: `TeamInactiveError`) |
| `deactivate(revoked_sessions: int)` | `staff.deactivated` |
| `reactivate(team: Team)` | `staff.reactivated` (its team must be active) |

### 2.3 `AdminRoster` (new singleton aggregate, `domain/people/admin_roster.py`)

The "at least one active admin" rule spans several `Staff` rows, so two concurrent demotions on different rows would both pass a count check (write skew). One small aggregate serialises every change to the set of active admins through its compare-and-set `version`:

```python
@dataclass(eq=False)
class AdminRoster(AggregateRoot):
    admin_ids: frozenset[str]          # active staff holding admin
    def grant(self, staff_id: str) -> None
    def revoke(self, staff_id: str) -> None   # leaving it empty → LastAdminError (last_admin)
```

- Loaded and saved by every command that adds or removes a member: create with `admin`; a roles change that adds or removes `admin` on an **active** person; deactivate or reactivate a person holding `admin`.
- One row, key `"default"`. Startup (`ensure_admin_roster`, bootstrap, idempotent) creates it from the active admins when it is missing; the seed writes it too.
- It records no events (the staff events say what happened).

### 2.4 Events (append-only `event_log`, snake_case payloads; never emails, passwords or tokens)

All have `actor = ActorRef(admin, <admin staff id>)` and `case_id = null`.

| `event_type` | Entity · id | Payload |
|---|---|---|
| `staff.created` | staff · target | `name`, `roles` (canonical order), `languages` (sorted), `team_id`, `team_name` |
| `staff.profile_updated` | staff · target | `changed_fields: ("name" \| "email")[]`, `from_name`, `to_name` (both equal when only the email changed) |
| `staff.roles_changed` | staff · target | `from_roles`, `to_roles`, `added`, `removed` |
| `staff.languages_changed` | staff · target | `from_languages`, `to_languages`, `added`, `removed` |
| `staff.team_changed` | staff · target | `from_team_id`, `from_team_name`, `to_team_id`, `to_team_name` |
| `staff.deactivated` | staff · target | `revoked_sessions: int` |
| `staff.reactivated` | staff · target | `{}` |
| `staff.account_unlocked` | staff · target | `was_locked: bool`, `failed_attempts: int` (before the reset) |
| `staff.password_reset` | staff · target | `revoked_sessions: int`, `cleared_lock: bool` |
| `team.created` | team · team | `name` |
| `team.renamed` | team · team | `from_name`, `to_name` |
| `team.deactivated` / `team.reactivated` | team · team | `name` |
| `staff.availability_changed` (existing) | staff · target | + optional **`reason`**: `"deactivated"` \| `"role_removed"` when administration paused her (absent = she changed it herself) |
| `auth.session_ended` (existing) | staff_session | `reason: "revoked"`, actor = the admin when administration ended it |

Team names in payloads are the names **at the time** (a later rename never rewrites the log).

### 2.5 `LoginAccount` (changed)

- `unlock(*, now, actor) -> bool`: when the counter is clear (no failures, no lock, or an expired lock), returns `False` and records nothing; else resets the counter and records `staff.account_unlocked`.
- `reset_password(new_hash, *, now, actor, revoked_sessions) -> None`: replaces the hash, resets the counter, records `staff.password_reset` (`cleared_lock` = it was locked now).

### 2.6 Persistence

| Table | Change |
|---|---|
| **`teams`** (new) | `id String(40) PK`, `name String(80) NOT NULL`, `name_key String(80) NOT NULL UNIQUE`, `active Boolean NOT NULL`, `created_at UtcDateTime NOT NULL`, `creation_key String(64) NULL UNIQUE`, `version` |
| `staff` | drop `team`; add `team_id String(40) NOT NULL FK teams.id` (indexed), `created_at UtcDateTime NOT NULL`, `creation_key String(64) NULL UNIQUE`. `email` stays unique (normalised). |
| **`admin_roster`** (new) | `id String(20) PK`, `admin_ids JSON NOT NULL`, `version` |

Memory store: same fields and the same uniqueness checks at commit.

### 2.7 Ports (application)

- `TeamRepository` (new, `uow.teams`): `get(team_id)`, `get_many(ids) -> dict`, `get_by_creation_key(key)`, `list() -> list[Team]` (by `name_key`, then id), `add`, `save` (unique `name_key` → `TeamNameTakenError`).
- `AdminRosterRepository` (new, `uow.admin_roster`): `get() -> AdminRoster | None`, `add`, `save`.
- `StaffRepository`: `add`/`save` raise `EmailTakenError` on a unique violation (the use case also checks first); `get_by_creation_key(key)`.
- `LoginAccountRepository`: + `list() -> list[LoginAccount]`.
- `StaffSessionRepository`: + `list_active_for(staff_id, now) -> list[StaffSession]`.
- `CaseRepository`: + `open_refs_by_assignee(staff_ids: set[str] | None = None) -> dict[str, list[OpenCaseRef]]` (`OpenCaseRef(case_id, language)`, statuses `assigned | in_progress`; one query).
- `TemporaryPasswordGenerator` (new, `application/ports/security.py`): `generate() -> str`. Tests use a fixed fake.
- `RealtimeHub`: + `close_principal(principal_id: str, reason: str) -> int` (closes every connection of that staff or customer id; §9.3).

Use cases live in `application/people/admin/` (`commands.py`, `team_commands.py`, `queries.py`, `guards.py`, `copy.py`, `realtime.py`, `dto.py`) and are bundled as **`AdministrationUseCases`**, reached by routers as `api.use_cases.administration.<name>`.

---

## 3. Commands

Every command:
- runs its whole body in `retry_on_conflict` and re-evaluates every rule on fresh state;
- first re-checks **the actor** on fresh state: an active `Staff` holding `admin` (else 403 `forbidden`; this is what serialises two admins demoting each other: the second one is no longer an admin when it retries);
- answers `changed: false` (200, no events, no save, version unchanged) when it would change nothing;
- saves every aggregate with compare-and-set; the events are committed in the order listed.

`expectedVersion` is the `Staff.version` / `Team.version` the admin saw. A mismatch is `409 version_conflict` with `currentVersion` and `current` (the record as `GET` returns it now, §8) and is never retried. Unlock and reset take no version: they do not edit the profile (they act on the login account, which has its own CAS).

### 3.1 `CreateUser` (`POST /admin/users`)

Rules in order: (1) actor; (2) `Idempotency-Key` replay (§3.9); (3) domain validation (name, email format, roles ≥ 1, analyst ⇒ languages ≥ 1) → 422 `invalid_value` (`field`; an empty or repeated `roles`/`languages` list already fails the request schema of §5.2 → 422 `validation_error`); (4) email free → 409 `email_taken`; (5) team exists → else 422 `invalid_value` (`field: "teamId"`); team active → else 422 `team_inactive` (`teamId`); (6) apply.

Effects: `Staff` (`active`, `created_at = now`, `version` 1); a `LoginAccount` with the hash of a generated temporary password (hashed once, cached across retries); with `admin` → `AdminRoster.grant`. No availability row (a missing row is `paused`: a new analyst starts "En pausa" and gets cases once she switches to "Disponible"). Event: `staff.created`. Response 201 `CreatedUser` with `temporaryPassword` (shown once; never stored in clear, never logged, never in an event).

### 3.2 `UpdateUser` (`PATCH /admin/users/{staffId}`)

Body fields are optional; absent = unchanged; at least one besides `expectedVersion` (else 422 `validation_error`). Rules in order:

| # | Check | Result |
|---|---|---|
| 1 | actor | 403 `forbidden` |
| 2 | target exists | 404 `not_found` |
| 3 | `expectedVersion == target.version` | 409 `version_conflict` |
| 4 | domain validation of the resulting person | 422 `invalid_value` (`field`) |
| 5 | new email not used by someone else | 409 `email_taken` |
| 6 | new team exists / is active | 422 `invalid_value` (`field: "teamId"`) / 422 `team_inactive` |
| 7 | the actor is not removing **her own** `admin` | 422 `self_change_forbidden` (`action: remove_own_admin`) |
| 8 | open cases (§3.6): removing `analyst` while she holds open cases; removing a language of one of her open cases | 409 `staff_has_open_cases` (`blockReason`, `openCases`, `caseIds`, `caseLanguage` for a language) |
| 9 | roster (adds/removes `admin` on an active person) | 409 `last_admin` |
| 10 | apply, save, commit | 200 `AdminUserChange` |

Effects, events in this order: `staff.profile_updated` (name and/or email), `staff.roles_changed`, `staff.languages_changed`, `staff.team_changed`; then side effects:
- `analyst` removed and her availability is `available` → set `paused` (`staff.availability_changed`, `reason: "role_removed"`, actor the admin);
- roles changed → the realtime `AccessTerminator` closes her sockets (§9.3); the REST side needs nothing: roles are re-read on every request (`AuthenticateSession`), so the change applies to her **next request**;
- languages added for an active, available analyst → `QueueDrainer` also listens to `staff.languages_changed` and drains the queues of the added languages (rule 3: "assigned as soon as an eligible analyst becomes available").

Editing an inactive person is allowed (e.g. move her to an active team before reactivating).

### 3.3 `DeactivateUser` (`POST /admin/users/{staffId}/deactivate`, body `{expectedVersion}`)

Rules in order: actor → 404 → `version_conflict` → **self** → 422 `self_change_forbidden` (`deactivate_self`) → already inactive → 200 no-op → open cases → 409 `staff_has_open_cases` (`blockReason: deactivate`) → roster (`admin`) → 409 `last_admin` → apply.

Effects, in this order: `staff.deactivated` (`revoked_sessions` = her active sessions now); availability `available` → `paused` (`reason: "deactivated"`); every active session ended (`auth.session_ended`, `revoked`, actor the admin); every pending MFA challenge cancelled (no event, see Sessions in §3.6). After commit `SessionTerminator` closes her sockets (4401: her SPA goes to `/login`). Her login account is untouched; she can no longer sign in (an inactive account answers like an unknown email: `invalid_credentials`, anti-enumeration rule of slice 0). Her cases' history, audit entries and team membership stay.

### 3.4 `ReactivateUser` (`POST /admin/users/{staffId}/reactivate`, body `{expectedVersion}`)

Rules: actor → 404 → `version_conflict` → already active → no-op → her team active → else 422 `team_inactive` (move her first) → roster grant if `admin` → apply. Event `staff.reactivated`. Availability stays as it is (`paused` since the deactivation). Her old password works again; the UI suggests "Restablecer contraseña" if she does not remember it.

### 3.5 `UnlockAccount` and `ResetPassword`

- **Unlock** (`POST /admin/users/{staffId}/unlock`, no body): actor → 404 → `LoginAccount.unlock` (no-op when clear). Allowed for inactive accounts too (harmless). Event `staff.account_unlocked`.
- **Reset** (`POST /admin/users/{staffId}/password-reset`, no body): actor → 404 → self → 422 `self_change_forbidden` (`reset_own_password`) → inactive → 409 `staff_inactive` → apply: new temporary password (generated and hashed once per request, cached across retries), counter reset, every active session ended (`revoked`), every pending MFA challenge cancelled. Events: `staff.password_reset`, then `auth.session_ended` × n. Not idempotent: each call issues a new password. 200 `PasswordResetResult` with `temporaryPassword`.

### 3.6 Open cases and deactivation: the decision

**Decision: administration never moves cases. A change that would leave an open case with someone who can no longer hold it is refused (`409 staff_has_open_cases`) until supervision reassigns those cases.** "Open case" = status `assigned | in_progress` with her as assignee (queued and closed cases are not hers). The blocking changes:
- deactivating her;
- removing her `analyst` role (a non-analyst cannot be an assignee: `load_case_for` grants assignee access to analysts only);
- removing a language of one of her open cases (rule 3: the case would stay with someone who does not speak its language).

Why not send the cases back to the queue automatically:
- **Rule 3 and the pause rule stay in one place.** Choosing who takes a case is `AssignCase` + `SetCaseAssignee` (slice 3). An automatic re-queue would need a new `Case` transition (`assigned | in_progress → queued`), a customer-visible notice ("Buscando a una persona…" again), SLA and read-cursor rules, and a second actor deciding assignments: a parallel assignment path the brief forbids (§4.6: one use case, a supervisor's manual seam, nothing else).
- **Accountability stays readable in the audit.** Each move is a `case.assigned` (`manual`) by a named supervisor with the banner and the customer notice of slice 3 §3.5, not a side effect of an account change.
- **Admins and supervisors are different roles.** An admin who is not a supervisor cannot see the cases (no `case.viewed` path); handing her a bulk move would bypass that boundary.

The cost is one extra step, and the UI makes it explicit: the dialog says how many open cases block the change and, when the admin also holds Supervisora, links to "Equipo y colas" with the analyst sheet open (`/supervision/equipo?analista=<id>`). Changes that do not touch case eligibility (name, email, team, adding roles or languages, `supervisor`/`admin` changes) are never blocked by cases.

**Sessions:** deactivation and password reset end every active session in the same Unit of Work (events → `SessionTerminator` closes the sockets). In the same Unit of Work they also **cancel every pending MFA challenge** of that person (`MfaChallenge.cancel(now)` → status `cancelled`, saved with CAS, no event: the reset or deactivation is the audited fact). A pending challenge proves a password step that is no longer valid (the old, maybe leaked, password after a reset; any sign-in started before a deactivation, even if she is reactivated within the 5-minute challenge TTL), so `POST /auth/mfa` on it answers 401 `mfa_challenge_invalid` and grants no session. A `VerifyMfa` racing the command loses its challenge (or login account) save, retries, and finds the challenge cancelled; if it committed first, its new session is among those the command ends. Role changes do **not** end sessions: the token stays valid, roles are re-read per request, and the sockets are closed with 4409 so they reconnect with the new roles (§9.3).

### 3.7 Team commands

| Command | Route | Rules in order | Event |
|---|---|---|---|
| `CreateTeam` | `POST /admin/teams` `{name}` (+ `Idempotency-Key`) | actor → replay → name valid (422 `invalid_value`, `field: "name"`) → `name_key` free (409 `team_name_taken`) | `team.created` (201) |
| `RenameTeam` | `PATCH /admin/teams/{teamId}` `{expectedVersion, name}` | actor → 404 → `version_conflict` → valid → same name → no-op → `name_key` free or its own → apply | `team.renamed` |
| `DeactivateTeam` | `POST /admin/teams/{teamId}/deactivate` `{expectedVersion}` | actor → 404 → `version_conflict` → already inactive → no-op → **no active members** (else 409 `team_not_empty`, `memberCount`) | `team.deactivated` |
| `ReactivateTeam` | `POST /admin/teams/{teamId}/reactivate` `{expectedVersion}` | actor → 404 → `version_conflict` → already active → no-op | `team.reactivated` |

- **Membership** has one write path: `PATCH /admin/users/{staffId}` with `teamId` (one event, `staff.team_changed`). The team screen's "Agregar persona" calls it with that person's `version`. There is no members endpoint and no way to leave a person without a team.
- An inactive team keeps its **inactive** members (history); it cannot receive anyone (`team_inactive`) and is not offered in the user form.
- Moving someone **into** a team (and creating or reactivating one of its members) bumps that team's `version` without an event (§3.8). A rename or (de)activation form must send the version of a fresh `GET`; the mutations' cache updates and `directory.updated` (`teamIds`) keep it fresh.
- Supervision lists a team only while it has at least one active analyst (§6).

### 3.8 Concurrency (CAS + retry)

| Race | Outcome |
|---|---|
| Two admins edit the same person | The second save fails CAS → retry → `expectedVersion` stale → 409 `version_conflict` with the first one's result. |
| Admin A removes B's `admin` while B removes A's | Each loads the roster; the second CAS fails → retry → its actor re-check finds she is no longer an admin → 403 `forbidden`. The roster never empties (`last_admin` is the domain backstop). |
| Two creates with the same email | The second hits the unique email → 409 `email_taken` (or the replay of §3.9 with the same key). Same for team names (`team_name_taken`). |
| Deactivate while supervision assigns her a case | Different aggregates: the assignment may land just before the deactivation commits, after the open-case check. Accepted limit (like slice 3 §3.9): the case stays with an inactive analyst until a supervisor reassigns it (the team screen no longer lists her, the queue does not hold it; documented in Known gaps, `SetCaseAssignee` already refuses inactive targets). |
| Remove `analyst` or a language while `AssignCase`/`DrainQueue` picks her | Same accepted limit. |
| A team is deactivated while someone is moved into it | `UpdateUser` loads the team; `DeactivateTeam` counts members on fresh state; whichever commits second sees the other's state on retry only if it touched the same row. To close the gap, `UpdateUser` saves the target team with CAS (`team.touch()` bumps its version without events) when moving someone in (and so do `CreateUser` and `ReactivateUser`, which also add an active member), so the two serialise. **The move commits first:** it bumped the team's `version`, so the deactivation's retry stops at its stale `expectedVersion` (rule order of §3.7) with 409 `version_conflict`, whose `current` already counts the new member; sent again with that version, it gets `team_not_empty`. **The deactivation commits first:** the move retries and sees an inactive team (`team_inactive`). `team_not_empty` answers a deactivation directly only when its `expectedVersion` already includes the move. |
| Unlock vs a failed login of the same account | Both save `LoginAccount` with CAS; the loser retries on fresh state (the counter is consistent either way). |

### 3.9 Idempotent creates

`POST /admin/users` and `POST /admin/teams` accept `Idempotency-Key`. The key is stored on the created row (`creation_key`). A retry with the same key:
- same email (user) / same `name_key` (team) → **200** (not 201) with the existing record, header `Idempotent-Replayed: true`; for a user `temporaryPassword: null` (the UI then says the password was shown in the first response and offers "Restablecer contraseña");
- anything else → 409 `idempotency_conflict` (existing code).

Without a key a retry is a plain duplicate (`email_taken` / `team_name_taken`).

---

## 4. Read models (`application/people/admin/queries.py`)

Each query reads through one Unit of Work with a fixed number of queries (staff, login accounts, availability, open-case refs, teams), never one per row.

### 4.1 `ListUsers`

Filters (AND): `q` (1–80; case- and accent-insensitive **contains** on name, email or id), `role: StaffRole`, `status: UserStatusFilter` (default `active`), `teamId`, `language: Language`. Order: name (accent-insensitive), then id. At most 500 rows.

Counts for the screen's pills, computed at `serverTime`:
- `roleCounts` = over every filter **except** `role` (`all`, `analyst`, `supervisor`, `admin`; a person with two roles counts in both);
- `statusCounts` = over every filter **except** `status` (`active` includes locked, `locked`, `inactive`, `all`).

### 4.2 Per-user fields (`AdminUser`)

- `status`, `lockedUntil` (null unless locked now), `failedAttempts` (the current counter; 0 after an expired lock), `lastLoginAt` (`LoginAccount.last_login_at`).
- `availability`: her `AvailabilityStatus` when she holds `analyst` (missing row → `paused`), else `null`.
- `openCases {total, es, pt}`: her `assigned | in_progress` cases by language.
- `guards {isSelf, lastActiveAdmin}`: `isSelf` = she is the caller; `lastActiveAdmin` = she is active, holds `admin`, and is the only such person.
- `version`: `Staff.version`.

### 4.3 Teams

`ListTeams(status)`: by name (accent-insensitive), with `memberCount` (active people), `analystCount` (active analysts), `inactiveMemberCount`; `statusCounts {active, inactive, all}`. `GetTeam(teamId)`: the team and its members (active first, then inactive; each by name) as `AdminTeamMember`.

---

## 5. REST API · administration

### 5.1 Endpoints (router `api/routers/administration.py`, tag `administration`, every route `require_roles(ADMIN)`)

| Method · path | Request | Success | Problems |
|---|---|---|---|
| `GET /api/v1/admin/users` | query `q?` · `role?` · `status?` · `teamId?` · `language?` | 200 **`AdminUserList`** | 401, 403, 422 |
| `GET /api/v1/admin/users/{staffId}` | — | 200 **`AdminUser`** | 401, 403, 404 |
| `POST /api/v1/admin/users` | **`CreateUserRequest`** + `Idempotency-Key?` | 201 **`CreatedUser`** (200 on replay) | 401, 403, 409 `email_taken` · `idempotency_conflict`, 422 `invalid_value` · `team_inactive` · `validation_error` |
| `PATCH /api/v1/admin/users/{staffId}` | **`UpdateUserRequest`** | 200 **`AdminUserChange`** | 401, 403, 404, 409 `version_conflict` · `email_taken` · `staff_has_open_cases` · `last_admin` · `concurrent_update`, 422 `invalid_value` · `team_inactive` · `self_change_forbidden` · `validation_error` |
| `POST /api/v1/admin/users/{staffId}/deactivate` | **`VersionRequest`** | 200 **`AdminUserChange`** | 401, 403, 404, 409 `version_conflict` · `staff_has_open_cases` · `last_admin`, 422 `self_change_forbidden` |
| `POST /api/v1/admin/users/{staffId}/reactivate` | **`VersionRequest`** | 200 **`AdminUserChange`** | 401, 403, 404, 409 `version_conflict` · `last_admin`, 422 `team_inactive` |
| `POST /api/v1/admin/users/{staffId}/unlock` | — | 200 **`AdminUserChange`** | 401, 403, 404 |
| `POST /api/v1/admin/users/{staffId}/password-reset` | — | 200 **`PasswordResetResult`** | 401, 403, 404, 409 `staff_inactive`, 422 `self_change_forbidden` |
| `GET /api/v1/admin/teams` | query `status?: TeamStatusFilter` | 200 **`AdminTeamList`** | 401, 403, 422 (unknown `status`) |
| `GET /api/v1/admin/teams/{teamId}` | — | 200 **`AdminTeamDetail`** | 401, 403, 404 |
| `POST /api/v1/admin/teams` | **`CreateTeamRequest`** + `Idempotency-Key?` | 201 **`AdminTeam`** (200 on replay) | 401, 403, 409 `team_name_taken` · `idempotency_conflict`, 422 |
| `PATCH /api/v1/admin/teams/{teamId}` | **`RenameTeamRequest`** | 200 **`AdminTeamChange`** | 401, 403, 404, 409 `version_conflict` · `team_name_taken`, 422 |
| `POST /api/v1/admin/teams/{teamId}/deactivate` | **`VersionRequest`** | 200 **`AdminTeamChange`** | 401, 403, 404, 409 `version_conflict` · `team_not_empty`, 422 `validation_error` |
| `POST /api/v1/admin/teams/{teamId}/reactivate` | **`VersionRequest`** | 200 **`AdminTeamChange`** | 401, 403, 404, 409 `version_conflict`, 422 `validation_error` |
| `GET /api/v1/staff` (existing) | + `includeInactive?: bool` (default false) | `StaffListResponse` (each `StaffOut` with `team: TeamRef`, + `active`) | unchanged (supervisor, admin) |
| `GET /api/v1/audit/events` (existing) | + `family=administration` | unchanged | unchanged (supervisor, admin) |

Operation ids: `admin_list_users`, `admin_get_user`, `admin_create_user`, `admin_update_user`, `admin_deactivate_user`, `admin_reactivate_user`, `admin_unlock_user`, `admin_reset_password`, `admin_list_teams`, `admin_get_team`, `admin_create_team`, `admin_rename_team`, `admin_deactivate_team`, `admin_reactivate_team`.

Path ids are validated (`STF-…`, `TEAM-…`); a malformed one is 404 `not_found`. Responses that carry a temporary password send `Cache-Control: no-store`.

### 5.2 Schemas

```ts
TeamRef { id: string; name: string }                 // replaces the slice 3 {key, name}

AdminUser {
  id: string; name: string; email: string
  roles: StaffRole[]                                 // canonical order: analyst, supervisor, admin
  languages: Language[]                              // sorted; may be [] only without analyst
  team: TeamRef
  status: AccountStatus                              // at serverTime (§1.1)
  lockedUntil: datetime | null
  failedAttempts: int
  lastLoginAt: datetime | null
  availability: AvailabilityStatus | null            // analysts only
  openCases: OpenCaseCounts
  createdAt: datetime
  guards: AdminUserGuards
  version: int
}
OpenCaseCounts  { total: int; es: int; pt: int }
AdminUserGuards { isSelf: boolean; lastActiveAdmin: boolean }

AdminUserList {
  items: AdminUser[]
  roleCounts: RoleCounts                             // §4.1
  statusCounts: UserStatusCounts
  serverTime: datetime
}
RoleCounts       { all: int; analyst: int; supervisor: int; admin: int }
UserStatusCounts { active: int; locked: int; inactive: int; all: int }

CreateUserRequest {
  name: string                                       // 2–120 after trim
  email: string                                      // ≤ 254
  roles: StaffRole[]                                 // 1–3, unique
  languages: Language[]                              // 0–2, unique (≥ 1 with analyst: domain rule → invalid_value)
  teamId: string
}
CreatedUser { user: AdminUser; temporaryPassword: string | null }   // null only on an idempotent replay

UpdateUserRequest {
  expectedVersion: int
  name?: string; email?: string; roles?: StaffRole[]; languages?: Language[]; teamId?: string
}
VersionRequest      { expectedVersion: int }
AdminUserChange     { changed: boolean; user: AdminUser; revokedSessions: int }   // revokedSessions > 0 only on deactivate
PasswordResetResult { user: AdminUser; temporaryPassword: string; revokedSessions: int }

AdminTeam {
  id: string; name: string; active: boolean
  memberCount: int; analystCount: int; inactiveMemberCount: int
  createdAt: datetime; version: int
}
AdminTeamList    { items: AdminTeam[]; statusCounts: TeamStatusCounts }
TeamStatusCounts { active: int; inactive: int; all: int }
AdminTeamMember  { id: string; name: string; roles: StaffRole[]; languages: Language[]; status: AccountStatus }
AdminTeamDetail  { team: AdminTeam; members: AdminTeamMember[] }
CreateTeamRequest { name: string }                   // 2–80
RenameTeamRequest { expectedVersion: int; name: string }
AdminTeamChange   { changed: boolean; team: AdminTeam }
```

Request bodies reject unknown fields (`RequestModel`), as in every slice.

### 5.3 `StaffOut` (changed, people)

`StaffOut { id; name; email; roles; languages; team: TeamRef; active: boolean }`. It affects `GET /staff`, `GET /auth/me` and the MFA session response. `StaffView.from_staff(staff, team)` takes the team (callers load it; `ListStaff` with `get_many`). `TeamRef` (schema) moves to `api/schemas/people.py` and `TeamRefView` (DTO) to `application/people/dto.py`; supervision imports them from there.

---

## 6. Teams in supervision (slug → id, end to end)

- `team_key()` is deleted. `TeamRef` and `TeamSummary` carry **`id`** (the `TEAM-…` id) instead of `key`; `name` is the team's current name.
- `GetTeamOverview` loads the teams of the listed analysts (`uow.teams.get_many`). `teams` = the active teams with at least one active analyst, by name. Unchanged otherwise (analysts = active staff holding `analyst`).
- Frontend: `TeamUrlState.team` holds the team id (`?equipo=TEAM-…`). An old slug URL is an unknown id → "Todos los equipos" (the existing fallback). `filterByTeam`, `selectedTeam`, `teamPillLabels` key by `id`.
- Supervision realtime gets more signals (§9.2); no new envelope.

---

## 7. Audit

### 7.1 Catalog additions (`application/audit/catalog.py`)

New family **`administration`** ("Administración" in the UI). `{P}` = the target's name (`entity_id` → staff names, inactive included); team names come from the payload. All are `changesState: true`.

| `event_type` | Family | Description (Spanish) |
|---|---|---|
| `staff.created` | administration | "Creó la cuenta de {P} · {roles} · {equipo}" (e.g. "Creó la cuenta de Ana Gil · Analista · Equipo Andes") |
| `staff.profile_updated` | administration | name only "Cambió el nombre de {from_name} a {to_name}" · email only "Cambió el correo de {P}" · both "Cambió el nombre y el correo de {P} (antes {from_name})" |
| `staff.roles_changed` | administration | added only "Le dio a {P} el rol de {added}" · removed only "Le quitó a {P} el rol de {removed}" · both "Cambió los roles de {P}: le dio {added} y le quitó {removed}" (`joinEs` of labels) |
| `staff.languages_changed` | administration | "Cambió los idiomas de {P}: ahora habla {to_languages}" (lower-case names; empty → "Cambió los idiomas de {P}: ya no tiene idiomas") |
| `staff.team_changed` | administration | "Pasó a {P} de {from_team_name} a {to_team_name}" |
| `staff.deactivated` | administration | "Desactivó la cuenta de {P}" + (1) " y cerró su sesión" / (n) " y cerró sus {n} sesiones" |
| `staff.reactivated` | administration | "Reactivó la cuenta de {P}" |
| `staff.account_unlocked` | administration | locked "Desbloqueó la cuenta de {P}" · not locked "Reinició los intentos de ingreso de {P}" |
| `staff.password_reset` | administration | "Restableció la contraseña de {P}" + the same session suffix |
| `team.created` | administration | "Creó el equipo {name}" |
| `team.renamed` | administration | "Le cambió el nombre al equipo {from_name}: ahora es {to_name}" |
| `team.deactivated` / `team.reactivated` | administration | "Desactivó el equipo {name}" / "Reactivó el equipo {name}" |
| `staff.availability_changed` (changed) | availability | without `reason` unchanged; `deactivated` "Dejó en pausa a {P} al desactivar su cuenta"; `role_removed` "Dejó en pausa a {P} al quitarle el rol de Analista" |
| `auth.session_ended` (changed) | access | `revoked` and actor ≠ `payload.staff_id` "Cerró la sesión de {P}" ({P} from `payload.staff_id`); otherwise unchanged |

- `AuditEvent.entity` gains `team`.
- The catalog test (every emitted type, no fallback text) runs over the seeded log, which now contains admin events (§11).
- Payloads: never emails (the existing guard test covers the new events); nothing is redacted for these types.

### 7.2 Admin entry point: reuse the audit feature

**Decision: `/administracion/auditoria` renders the same `AuditScreen` (same URL state, same API) in the admin section**, not a link to `/supervision/auditoria`, because an admin who is not a supervisor cannot open the supervision section (the guard sends her home). Differences, through props only:
- `canOpenCases` (new prop, default `true`): the route passes `hasRole('supervisor')`. When `false`, the detail aside hides "Ver la conversación" (the case view is supervision-only) and keeps "Filtrar por este caso".
- The admin route does not mount `useQueueNotices()` (no supervision toasts in admin mode).
- From a user's aside, "Ver en auditoría" opens `/administracion/auditoria?q=<STF-id>` (`q` matches `actor_id` and `entity_id`, so it lists what she did and what was done to her account). From a team's aside: `?q=<TEAM-id>`.

`/supervision/auditoria` is unchanged apart from the new family and texts.

---

## 8. Problem codes

New members of `ProblemCode` (`api/problems.py`):

| Code | Status | Title | Default detail (Spanish) | Extensions |
|---|---|---|---|---|
| `version_conflict` | 409 | Version conflict | "Alguien más cambió este registro mientras editabas." | `currentVersion: int`, `current: object` (the record as `GET` returns it now: `AdminUser` or `AdminTeam`) |
| `email_taken` | 409 | Email already in use | "Ya existe una cuenta con ese correo." | `field: "email"` |
| `team_name_taken` | 409 | Team name already in use | "Ya existe un equipo con ese nombre." | `field: "name"` |
| `self_change_forbidden` | 422 | Self change forbidden | "No puedes hacer ese cambio sobre tu propia cuenta." | `action: SelfChangeAction` |
| `last_admin` | 409 | Last administrator | "Debe quedar al menos una persona activa con el rol de Administración." | — |
| `staff_has_open_cases` | 409 | Staff has open cases | "Tiene casos abiertos. Supervisión tiene que reasignarlos antes de este cambio." | `blockReason: OpenCasesBlock`, `openCases: int`, `caseIds: string[]` (≤ 20), `caseLanguage?: Language` (for `remove_language`) |
| `team_not_empty` | 409 | Team not empty | "El equipo todavía tiene personas activas." | `memberCount: int` |
| `team_inactive` | 422 | Team inactive | "Ese equipo está desactivado." | `teamId` |
| `staff_inactive` | 409 | Account inactive | "Esta cuenta está desactivada." | — |

- `ProblemDetails` gains the typed optional members `field`, `currentVersion`, `current` (`dict[str, Any]`, documented), `action`, `blockReason`, `openCases`, `caseIds`, `memberCount`, `teamId` (`caseLanguage` exists).
- Errors: `TeamNotEmptyError`, `TeamInactiveError`, `LastAdminError`, `EmailTakenError`, `TeamNameTakenError` in `domain/people/errors.py`; `VersionConflictError` (generic, carries `current_version` and a `current_view`), `SelfChangeForbiddenError`, `StaffHasOpenCasesError`, `StaffInactiveError` in `application/errors.py` / `application/people/admin/errors.py`.
- `current` is built in the API layer: the router catches `VersionConflictError`, renders `current_view` with the response schema (`AdminUser.from_view(...)` / `AdminTeam.from_view(...)`, camelCase) and re-raises it with the `current` detail (one helper, `api/routers/administration.py::_with_current`). The application layer never builds JSON.
- Unchanged codes used here: `forbidden` (+`requiredRoles`), `not_found`, `invalid_value`, `validation_error`, `idempotency_conflict`, `concurrent_update` (only after the retry budget is exhausted).

---

## 9. Realtime

### 9.1 Topics and access

| Topic | Who may subscribe | Carries |
|---|---|---|
| existing (`case:`, `inbox:`, `customer:`, `supervision:*`) | unchanged | unchanged |
| **`admin:directory`** | staff holding `admin` | `directory.updated` |
| **`staff:<STF-id>`** | only that staff member (any role) | `me.updated` |

`TopicKind.ADMIN` (key must be `directory`) and `TopicKind.STAFF` (key a `STF-` id); `Topic.admin_directory()`, `Topic.staff(staff_id)`; any other key → `invalid_topic`. Customers never.

### 9.2 Envelopes

| `type` | Topic | `payload` | Emitted after |
|---|---|---|---|
| **`directory.updated`** | `admin:directory` | `{ staffIds: string[]; teamIds: string[] }` (what may have changed) | every `staff.*` event above, `staff.availability_changed`, `auth.account_locked`, every `team.*` event; `case.assigned` and `case.closed` (they change someone's `openCases`) |
| **`me.updated`** | `staff:<id>` | `StaffOut` (fresh) | `staff.profile_updated`, `staff.roles_changed`, `staff.languages_changed`, `staff.team_changed` of that person; `team.renamed` → one per active member of the team |
| `team.updated` (existing) | `supervision:team` | `{ staffIds }` | + every `staff.*` event of an analyst (before or after the change) and `team.renamed`/`team.deactivated`/`team.reactivated` (`staffIds` may be empty: clients refetch anyway) |
| `queue.updated` (existing) | `supervision:queues` | `QueueCounts` | + `staff.roles_changed`, `staff.languages_changed`, `staff.deactivated`, `staff.reactivated` (`speakers`/`availableSpeakers` changed; clients refetch) |

- Producer: **`AdministrationRealtimeProjector`** (`application/people/admin/realtime.py`), presenter pattern of slice 2 (payloads = REST schemas; a contract test validates `me.updated` against `StaffOut`). Envelope `id` = source event id. The new `staff.*`/`team.*` events are suppressed in the raw `RealtimeProjector` (`TopicMapper.suppress`).
- Sockets only signal: `directory.updated` carries ids, never rows. `staffIds` is the person of a `staff.*`, availability or lock event (empty for `team.*`); `teamIds` is the team(s) whose counts may have moved (`staff.created`: her team; `staff.team_changed`: both; other `staff.*`: her current team; `team.*`: that team; availability and locks: none).
- **Case moves.** `AdminUser.openCases` gates deactivation and removing Analista or a language (§3.6), so the directory must follow it: `case.assigned` signals `staffIds = [previous analyst, new analyst]` (only the new one when it came from the queue), `case.closed` signals its assignee; `teamIds` is empty (no team count changes). Without it, once supervision reassigns her cases the admin's cached record would keep blocking the deactivation until a reload. These events still reach their own topics through the raw `RealtimeProjector`; this is an extra, ids-only signal.
- On a **roles** change the `AccessTerminator` closes her sockets in the same publish cycle, so the `me.updated` of that change is usually not delivered: after a 4409 the client's `/auth/me` refetch (§10.8) is what updates the session. `me.updated` does arrive for name, email, language and team changes and for `team.renamed`.

### 9.3 Role changes and sockets (`AccessTerminator`)

A socket keeps the `Actor` it authenticated with, and subscriptions are checked at subscribe time, so after a roles change it would keep topics she lost and be refused topics she gained. So:
- New bus subscriber **`AccessTerminator`** (`application/realtime/projector.py`, next to `SessionTerminator`): on `staff.roles_changed` it calls `hub.close_principal(staff_id, "access_changed")`.
- The WebSocket closes those connections with code **4409**, reason `access_changed` (pump ends with that close reason).
- Client (§10.8): 4409 is **not** an auth error. It refetches `/auth/me` and reconnects right away (no backoff); the replayed subscriptions are re-checked with the new roles, and a topic she lost answers `forbidden` (its owner screen is gone after the guard redirect).
- Deactivation and password reset end the sessions → existing `SessionTerminator` → 4401 → the SPA signs out.

---

## 10. Frontend

One agent owns all of `frontend/`. It may extend `components/ui`, `components/layout`, `lib/realtime` and `styles/index.css` (tokens only), never fork them. New feature **`features/admin`** imports no other feature (only `@/app/roles`, `@/app/session`, `@/components/*`, `@/lib/*`). Route modules compose: `routes/admin/users.tsx`, `routes/admin/teams.tsx` → `@/features/admin`; `routes/admin/audit.tsx` → `@/features/audit`.

### 10.1 Routes, roles and the rail

| Path | Screen | Guard |
|---|---|---|
| `/administracion/usuarios?rol=&estado=&equipo=&idioma=&q=&persona=&nueva=` | Usuarios y roles | admin |
| `/administracion/equipos?estado=&equipo=&nuevo=` | Equipos | admin |
| `/administracion/auditoria?…` (the slice 3 audit params) | Auditoría (§7.2) | admin |

- `app/roles.ts` admin `nav`: "Usuarios y roles" (`UserPlus`, `indicator: 'lockedAccounts'`), "Equipos" (`UsersRound`), "Auditoría" (`Shield`). `RailIndicatorKey` += `'lockedAccounts'`.
- `app/rail-indicators.ts`: `useLockedAccountsCount({ enabled: role === 'admin' })` from `@/features/admin/core` → `lockedAccounts: { count }` when `> 0` (the rail names it "Usuarios y roles, 1 pendiente").
- `/administracion/herramientas`, `/reglas`, `/retencion` (and the automation URLs) stay removed: keep the guards test that `/administracion/reglas` shows the not-found page, and add `/administracion/herramientas` and `/administracion/retencion` to it.
- Path helpers in `app/roles.ts`: `adminUserPath(staffId)` (`/administracion/usuarios?persona=<id>`), `adminTeamPath(teamId)`, `adminAuditPath(q)`.

### 10.2 `UsersScreen` (canvas Admin `usuarios`)

Layout: `section aria-label="Personas"` (table) + `aside aria-label="Persona seleccionada"` (400 px, white), must not break at 1280.
- **PageHeader** "Usuarios y roles"; subtitle "Quién puede hacer qué en la plataforma · {n} personas" (n = `statusCounts.all`); actions: primary "Nueva persona" (`?nueva=1`) and `SampleDataTag`.
- **Toolbar:** role pills (`SegmentedControl` pills, native radios; canvas `tablist` replaced) "Todas {all}" · "Analistas {analyst}" · "Supervisoras {supervisor}" · "Administración {admin}"; `Select` "Cuenta": "Activas" · "Bloqueadas ({locked})" · "Desactivadas" · "Todas"; `Select` "Equipo" ("Todos los equipos" + active and inactive teams); `Select` "Idioma" ("Todos" · "Español" · "Portugués"); `SearchInput` (label "Buscar persona", placeholder "Buscar por nombre, correo o id", ≤ 80, debounced 300 ms); ghost "Limpiar filtros" when any is set.
- **Table** (`Table`, sticky header, `TRowSelect` → `?persona=`): **Persona** (name; email in muted second line) · **Roles** (role chips: Analista `bg-panel text-ink-2`, Supervisora `bg-peach text-warn-strong`, Administración `bg-success-tint text-success-ink`; a feature-local `RoleChips`) · **Idiomas** ("español, portugués" or "—") · **Equipo** (name, truncated with `title`) · **Cuenta** ("Activa" ink-2; "Bloqueada" warn with a lock icon and `title` "Hasta las {hora}"; "Desactivada" muted). The status is recomputed with `useNow` from `lockedUntil` (an expired lock reads "Activa").
- Footer `SourceNote`: "Personas, roles, idiomas y equipos: directorio de la plataforma (datos de ejemplo)."
- **States** (`QueryState`): skeleton rows; empty with filters "Nadie coincide con estos filtros." + "Limpiar filtros"; error danger `Callout` + "Reintentar".

**Aside** (`UserPanel`; nothing selected: "Elige una persona para ver y editar su cuenta."; unknown `persona` → `GET /admin/users/{id}`; 404 → "No encontramos a esa persona."):
- Header: name (18 px semibold), "{roles} · {idiomas} · {equipo}", id (mono, copyable).
- **Status callout** (when not active): locked → warn "Cuenta bloqueada hasta las {hora} tras {n} intentos fallidos." + secondary "Desbloquear"; inactive → neutral "Cuenta desactivada. No puede ingresar." + secondary "Reactivar cuenta".
- **Edit form** (`UserForm`, shared with the create dialog): "Nombre completo", "Correo", fieldset **ROLES** (three checkbox cards with label + `ROLE_DESCRIPTION`, canvas look), fieldset **IDIOMAS** (Español, Portugués; hint "Quien atiende casos necesita al menos un idioma. Los casos en portugués solo llegan a quien lo habla (regla 3)."), `Select` "Equipo" (active teams; the current team even if inactive, marked "(inactivo)"). Note under roles: "Los cambios de rol se aplican de inmediato: la persona ve su menú actualizado sin volver a ingresar."
- **Facts** (`KeyValueList`): Último ingreso ("hace 2 h" / "Nunca"), Ahora ("Disponible"/"En pausa", analysts only), Casos abiertos ("{total}" + "· {es} en español · {pt} en portugués" when > 0), Cuenta creada (date).
- **Footer:** primary "Guardar cambios" (enabled when the draft differs; validation and the open-case checks run on submit and focus the first invalid control, so a disabled button never hides why; `loading` while pending), then ghost "Restablecer contraseña", danger-ghost "Desactivar cuenta" (inactive: hidden), link "Ver en auditoría".
- **Guard rails** (from `guards`, `openCases`, model `userGuardState(user)`):

  | Situation | UI |
  |---|---|
  | `isSelf` | Administración card disabled, description "No puedes quitarte tu propio rol de Administración."; "Desactivar cuenta" disabled with hint "No puedes desactivar tu propia cuenta."; "Restablecer contraseña" disabled with hint "Pídele a otra persona de Administración que restablezca tu contraseña." |
  | `lastActiveAdmin` (not self) | Administración card disabled, "Es la única persona activa con Administración."; "Desactivar cuenta" disabled with the same text |
  | Analista unchecked and `openCases.total > 0` | field error on ROLES at submit: "Tiene {n} casos abiertos: supervisión tiene que reasignarlos antes de quitarle el rol de Analista." (no `PATCH`; when the cached record would block, submit first re-reads the person and decides on that fresh count, the same for the language block below) |
  | A language unchecked and `openCases[lang] > 0` | field error on IDIOMAS: "Tiene {n} casos abiertos en {idioma}: supervisión tiene que reasignarlos antes de quitarle ese idioma." |

- **Dirty draft + live update:** when the user's `version` in the cache moves past the draft's base version, show an info `Callout` "Alguien más acaba de cambiar a esta persona. Si guardas, revisaremos que no choquen tus cambios." and keep the draft. Without a draft, the form follows the cache.

### 10.3 Dialogs (`features/admin`)

- **Create** (`CreateUserDialog`, `?nueva=1`, `Dialog` md): title "Nueva persona", the `UserForm` (empty; Equipo preselected when `?equipo=` filters one active team), footer "Cancelar" + primary "Crear cuenta". The mutation sends an `Idempotency-Key` (one UUID per open dialog). Success → closes and opens **`TemporaryPasswordDialog`**, selects the new person (`?persona=`).
- **`TemporaryPasswordDialog`** (created or reset): title "Cuenta creada" / "Contraseña restablecida"; text "{Nombre} ya puede ingresar con su correo y esta contraseña temporal. Cópiala ahora: no la volveremos a mostrar."; the password (mono, 20 px, selectable) + "Copiar" (`navigator.clipboard`, label → "Copiada"); muted footnote "En desarrollo, el código de verificación es 000000."; primary "Listo". The password lives only in component state (never in the URL, the query cache or storage). On a replay (`temporaryPassword: null`): "La contraseña temporal se mostró al crear la cuenta. Si no la tienes, restablécela." + "Restablecer contraseña".
- **Reset** (`ResetPasswordDialog`, `Dialog` sm): "¿Restablecer la contraseña de {Nombre}?"; "Se genera una contraseña temporal nueva, se cierran sus sesiones abiertas y se desbloquea la cuenta si estaba bloqueada." → "Restablecer" → `TemporaryPasswordDialog`.
- **Deactivate** (`DeactivateUserDialog`, `Dialog` sm): "¿Desactivar la cuenta de {Nombre}?"; list: "No podrá ingresar." · "Se cierran sus sesiones abiertas ahora." · "Deja de recibir casos y queda En pausa." · "Su historial y la auditoría se conservan."; danger "Desactivar cuenta". With `openCases.total > 0`: warn `Callout` "Tiene {n} casos abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta." + (viewer holds Supervisora) link "Abrir en Equipo y colas" → `/supervision/equipo?analista=<id>`; the confirm button is disabled. The dialog re-reads the person when it opens (`useRecheckAdminUser`) and decides the block on that fresh record (the confirm stays disabled while it reads), so a count supervision already cleared never keeps it blocked. Success toast "Cuenta desactivada" / "{Nombre} ya no puede ingresar.{ Se cerró su sesión.| Se cerraron sus {n} sesiones.}".
- **Reactivate** (from the callout, no dialog): toast "Cuenta reactivada" / "{Nombre} puede volver a ingresar con su contraseña. Empieza En pausa."
- **Unlock** (no dialog): toast "Cuenta desbloqueada" / "{Nombre} ya puede volver a intentar ingresar."; `changed: false` → info toast "La cuenta ya no estaba bloqueada."
- **Save** success: toast "Cambios guardados"; `changed: false` → nothing (the button was disabled).

### 10.4 Failure copy (`describeAdminFailure(problem, ctx)` in `model.ts`)

| Code | Copy | Then |
|---|---|---|
| `version_conflict` | "Alguien más cambió {a esta persona \| este equipo} mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar." | `setQueryData` with `current` (validated by `readAdminUser`/`readAdminTeam`; invalid → invalidate), reset the draft to it |
| `email_taken` | "Ya existe una cuenta con ese correo." | field error on Correo, focus it |
| `team_name_taken` | "Ya existe un equipo con ese nombre." | field error on Nombre |
| `self_change_forbidden` | per `action`: the three texts of §10.2 | — |
| `last_admin` | "Debe quedar al menos una persona activa con Administración." | refetch |
| `staff_has_open_cases` | per `blockReason`: deactivate "Tiene {n} casos abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta."; remove_analyst / remove_language: the field texts of §10.2 | refetch the user |
| `team_not_empty` | "Para desactivarlo, primero mueve a sus {n} personas a otro equipo." | refetch the team |
| `team_inactive` | "Ese equipo está desactivado. Elige otro." | field error on Equipo, refetch teams |
| `staff_inactive` | "Esta cuenta está desactivada. Reactívala primero." | refetch |
| `invalid_value` | by `field`: the client validation text of that field | field error |
| other | "No pudimos guardar los cambios. Inténtalo de nuevo." | |

Client validation (`validateUserDraft`, `validateTeamName`), run before any request, first invalid control focused: Nombre "Escribe el nombre completo (al menos 2 caracteres)."; Correo "Escribe un correo válido, como nombre@latambank.example."; ROLES "Elige al menos un rol."; IDIOMAS (with Analista) "Quien atiende casos necesita al menos un idioma."; Equipo "Elige un equipo."; team name "Escribe un nombre de al menos 2 caracteres."

### 10.5 `TeamsScreen`

Same two-column layout (`section aria-label="Equipos"` + `aside aria-label="Equipo seleccionado"` 400 px).
- PageHeader "Equipos"; subtitle "Cómo se agrupan las personas en la plataforma · {n} equipos"; actions primary "Nuevo equipo" (`?nuevo=1`) + `SampleDataTag`.
- Pills "Activos {active}" · "Inactivos {inactive}" · "Todos {all}". Table: **Equipo** · **Personas** (`memberCount`) · **Analistas** (`analystCount`) · **Estado** ("Activo" / "Inactivo" muted). Row select → `?equipo=`. Empty: "No hay equipos en este estado.".
- **Aside**: name, id (mono), "Creado el {fecha}"; inline rename (`Field` "Nombre del equipo" + "Guardar nombre", `expectedVersion`); members (`AdminTeamMember` rows: name as a link to `adminUserPath`, role chips, languages, inactive ones muted with "Desactivada"); "Agregar persona" (active team only); footer danger-ghost "Desactivar equipo" (disabled when `memberCount > 0`, hint "Para desactivarlo, primero mueve a sus {n} personas a otro equipo.") or secondary "Reactivar equipo"; link "Ver en auditoría". Empty members: "Este equipo no tiene personas.".
- **`AddMemberDialog`**: "Agregar a {equipo}"; `Select` "Persona" of active people **not** in this team ("{nombre} · {equipo actual}"); line "Pasa de {equipo actual} a {equipo}."; primary "Mover a {equipo}" → `PATCH /admin/users/{id}` `{expectedVersion: person.version, teamId}` (the person rows come from `GET /admin/users?status=active`). Errors through §10.4.
- **`CreateTeamDialog`** (`?nuevo=1`): "Nuevo equipo", `Field` "Nombre", "Crear equipo" (with `Idempotency-Key`); success selects it. Deactivate/reactivate: confirm `Dialog` sm "¿Desactivar el equipo {nombre}?" / "Ya no se podrá mover a nadie a este equipo. Su historial se conserva."; toasts "Equipo desactivado" / "Equipo reactivado".

### 10.6 Admin audit route

`routes/admin/audit.tsx`: parses the audit URL with `parseAuditSearch`, renders `AuditScreen` with `canOpenCases={hasRole('supervisor')}`. The audit feature gains: the `canOpenCases` prop; `AuditFamily` option "Administración" (`?tipo=administracion`); kind/entity handling for `team`; the "Persona" select uses `GET /staff?includeInactive=true` and marks inactive people "(desactivada)".

### 10.7 Session live sync and the role switcher (app)

- `app/session-live.tsx` exports `<SessionLiveSync />`, mounted in `AppProviders` inside `ToastProvider`. While authenticated it subscribes `staff:<me.id>`.
- `app/session-realtime.ts` exports `registerSessionRealtime: RealtimeRegistration` (added to `FEATURE_REALTIME_REGISTRATIONS`): `me.updated` → `setQueryData(sessionKeys.me(), payload)` when `payload.id` is the cached me.
- `SessionLiveSync` also listens to the client's access-changed signal (§10.8) → `invalidateQueries(sessionKeys.me())`.
- When `roleIds` change it shows one toast: "Cambiaron tus roles" / "Ahora tienes: {joinEs(labels)}." The `RoleSwitcher` and the rail update from `useSession()`; `RequireRole` sends her to her first role home if the current section is gone (existing guard).
- `toSessionUser`: `summary` uses `staff.team.name`.

### 10.8 `src/lib/realtime`

- `KnownRealtimeEventType` += `'directory.updated' | 'me.updated'`; `RealtimeTopic` += `` 'admin:directory' `` and `` `staff:${string}` ``; `topics.adminDirectory()`, `topics.staff(id)`.
- `RealtimeClient`: `ACCESS_CHANGED_CLOSE_CODE = 4409`. On it: no `onAuthError`, reconnect immediately (attempt counter reset, no backoff delay), and notify `onAccessChanged` listeners (`client.onAccessChanged(listener): () => void`, like the status listeners). `AUTH_CLOSE_CODES` stays `{1008, 4401, 4403}`. Tests: 4409 reconnects at once and calls the listener; 4401 still ends the session.

### 10.9 `features/admin` data and realtime

- Hooks: `useAdminUsers(filters)` (`GET /admin/users`), `useAdminUser(id)` (seeded from the list cache when present, `GET /admin/users/{id}` otherwise), `useAdminTeams(status)`, `useAdminTeam(id)`, mutations `useCreateUser`, `useUpdateUser(id)`, `useDeactivateUser(id)`, `useReactivateUser(id)`, `useUnlockUser(id)`, `useResetPassword(id)`, `useCreateTeam`, `useRenameTeam(id)`, `useDeactivateTeam(id)`, `useReactivateTeam(id)`. On success: `setQueryData(adminKeys.user(id), result.user)` and invalidate `adminKeys.users()` lists and the affected teams.
- `useLockedAccountsCount({ enabled })` = `useAdminUsers({})` + `select: (l) => l.statusCounts.locked`, `refetchInterval` 60 s (locks expire on their own), and subscribes `admin:directory` while enabled.
- `UsersScreen` and `TeamsScreen` subscribe `admin:directory` and refetch on reconnect (`useOnReconnect`).
- `registerAdminRealtime`: `directory.updated` → invalidate `adminKeys.users()` (prefix), `adminKeys.user(id)` for each `staffIds`, `adminKeys.teams()` (prefix) and `adminKeys.team(id)` for each `teamIds` (and every team when `staffIds` is non-empty: memberships may have moved).

### 10.10 Supervision migration (§6)

`TeamRef.id`/`TeamSummary.id` everywhere `key` was used; `TeamUrlState.team` = team id; test fixtures (`src/test/supervision-fixtures.ts`) use `TEAM-…` ids. No visible change.

### 10.11 URL state (frozen)

```ts
// features/admin/model.ts
export interface UsersUrlState {
  role: RoleId | null                      // ?rol=analistas|supervisoras|administracion
  status: UserStatusFilter                 // ?estado=activas|bloqueadas|desactivadas|todas (default activas)
  teamId: string | null                    // ?equipo=TEAM-…
  language: Language | null                // ?idioma=es|pt
  query: string                            // ?q=
  staffId: string | null                   // ?persona=STF-…
  create: boolean                          // ?nueva=1
}
export interface TeamsUrlState {
  status: TeamStatusFilter                 // ?estado=activos|inactivos|todos (default activos)
  teamId: string | null                    // ?equipo=TEAM-…
  create: boolean                          // ?nuevo=1
}
```

Pairs `parseUsersSearch`/`toUsersSearch`, `parseTeamsSearch`/`toTeamsSearch`, plus `usersQueryOf(state): AdminUserFilters`. Unknown values fall back to the defaults. Filter changes `replace`; selecting a row or opening a create dialog pushes. Confirm dialogs (reset, deactivate, add member) are local state, not URL.

### 10.12 Public API and query keys (frozen)

```ts
// src/features/admin/core.ts: screen-free, the only admin file the app shell imports
export { useLockedAccountsCount } from './hooks/use-admin-queries'
export { adminKeys, adminMutationKeys } from './api'
export { registerAdminRealtime } from './realtime'
export type { AdminUser, AdminTeam, AdminTeamDetail,
  AccountStatus, UserStatusFilter, TeamStatusFilter } from './types'

// src/features/admin/index.ts
export * from './core'
export { UsersScreen } from './components/UsersScreen'   // { state, onStateChange(patch: Partial<UsersUrlState>, opts?), canOpenSupervision: boolean }
export { TeamsScreen } from './components/TeamsScreen'   // { state, onStateChange(patch: Partial<TeamsUrlState>, opts?) }
export type { UsersScreenProps, TeamsScreenProps }
export { parseUsersSearch, toUsersSearch, parseTeamsSearch, toTeamsSearch } from './model'
export type { UsersUrlState, TeamsUrlState, UrlStateChangeOptions /* { replace?: boolean } */ } from './model'

// src/app/roles.ts (role vocabulary of the shell, used by SessionLiveSync and admin)
export const ROLE_LABEL: Record<RoleId, string>   // pinned to the backend copy
export function rolesLabel(roles): string          // "Analista y Supervisora"
export function rolesNowCopy(roles): string        // "Ahora tienes: …."

export const adminKeys = {
  all: ['admin'] as const,
  users: () => ['admin', 'users'] as const,
  userList: (filters: AdminUserFilters) => ['admin', 'users', filters] as const,
  user: (staffId: string) => ['admin', 'user', staffId] as const,
  teams: () => ['admin', 'teams'] as const,
  teamList: (status: TeamStatusFilter) => ['admin', 'teams', status] as const,
  team: (teamId: string) => ['admin', 'team', teamId] as const,
}
export const adminMutationKeys = {
  createUser: ['admin', 'create-user'] as const,
  user: (staffId: string, action: 'update' | 'deactivate' | 'reactivate' | 'unlock' | 'reset') =>
    ['admin', 'user', staffId, action] as const,
  createTeam: ['admin', 'create-team'] as const,
  team: (teamId: string, action: 'rename' | 'deactivate' | 'reactivate') => ['admin', 'team', teamId, action] as const,
}
```

`features/audit/index.ts` keeps its exports; `AuditScreen` props gain `canOpenCases?: boolean`.

---

## 11. Seed ("Datos de ejemplo", invented people)

Same rules as slices 2–3: stable ids, times relative to the first seed (`T`), through the domain, events recorded with the story's time into the one seed timeline. Every slice 3 number (queues, team rows, Daniela's inbox) is unchanged.

### 11.1 Teams

| n | Id | Name | State |
|---|---|---|---|
| 1 | `TEAM-0…01` | Equipo Andes | active |
| 2 | `TEAM-0…02` | Equipo Pacífico | active |
| 3 | `TEAM-0…03` | Administración de la plataforma | active |
| 4 | `TEAM-0…04` | Equipo Caribe | **inactive**, no members: created by Valeria at T−3d (`team.created`), deactivated by Valeria at T−1d (`team.deactivated`) |

(`make_id(IdPrefix.TEAM, str(n).zfill(26))`.) Teams 1–3 have no creation event (they existed before the log); `created_at` = T−30d.

### 11.2 Staff

The eleven seeded people keep their ids, roles, languages and password; `team` becomes the `team_id` of the same name; `created_at` = T−30d. Two new people (both invisible to the supervision team screen, so slice 3 counts do not move):

| n | Name | Email | Roles · languages · team | State |
|---|---|---|---|---|
| 12 | Mariana Duque | `mariana.duque@latambank.example` | Supervisora · es · Equipo Pacífico | **locked**: five wrong passwords at T−6m, T−5m, T−4m, T−3m, T−2m (`auth.login_failed` × 5, actor herself) → `auth.account_locked` until T+13m. The rail badge shows 1 until it expires or someone unlocks it. |
| 13 | Andrés Villamil | `andres.villamil@latambank.example` | Analista · es · Equipo Andes | **inactive**: deactivated by Carolina Peña at T−2d (`staff.deactivated`, `revoked_sessions: 0`). No cases, no availability row. |

Admin story in the log: Valeria gave Felipe the Supervisora role at T−5d (`staff.roles_changed`, `from [analyst]` → `to [analyst, supervisor]`). `AdminRoster` = {Valeria, Carolina}.

### 11.3 What the screens show on a fresh database (signed in as Valeria)

| Where | Expected |
|---|---|
| Rail | "Usuarios y roles, 1 pendiente" · "Equipos" · "Auditoría" |
| Usuarios (Activas) | 12 people; pills Todas 12 · Analistas 6 · Supervisoras 5 · Administración 2; Cuenta select "Bloqueadas (1)"; Mariana "Bloqueada" |
| Usuarios (Desactivadas) | Andrés Villamil |
| Valeria's own aside | Administración card disabled "No puedes quitarte tu propio rol de Administración."; "Desactivar cuenta" disabled |
| Daniela's aside | Analista · español, portugués · Equipo Andes; Casos abiertos "5 · 4 en español · 1 en portugués" (her seeded inbox); unchecking Portugués → the IDIOMAS error; "Desactivar cuenta" → the open-cases block |
| Equipos (Activos 3 · Inactivos 1 · Todos 4) | Administración de la plataforma: 2 personas, 0 analistas (Valeria, Carolina) · Equipo Andes: 4 personas, 3 analistas (Daniela, Felipe, Julián, Lucía) + 1 desactivada (Andrés) · Equipo Pacífico: 6 personas, 3 analistas (Mariana, Martín, Paula, Renata, Sebastián, Tomás). Inactivos: Equipo Caribe (0) |
| Auditoría (admin) · Tipo "Administración" | "Desactivó el equipo Equipo Caribe", "Desactivó la cuenta de Andrés Villamil", "Creó el equipo Equipo Caribe", "Le dio a Felipe Echeverri el rol de Supervisora"; Mariana's lock under Accesos; "Ver la conversación" hidden for Valeria |
| Equipo y colas (Lucía) | unchanged from slice 3 §9.4 (pills now keyed by team id) |

Update `backend/README.md`: accounts table (Mariana locked, Andrés inactive, teams), the administration endpoints, temporary passwords, the "delete `cc_platform.db`" note.

---

## 12. Tests and done criteria

**Backend.** Every gate of brief §6 passes, plus:
- **Domain:** `Team` (create, rename no-op, `name_key` rules, deactivate with members → `team_not_empty`, reactivate); `Staff` (analyst ⇒ languages, each setter's event and no-op, `move_to` an inactive team, deactivate/reactivate); `AdminRoster` (grant, revoke, last one → `last_admin`); `LoginAccount.unlock` (locked, expired lock, clear → no-op) and `reset_password`.
- **Commands:** every rule table of §3 in order (403 on a demoted actor, 404, `version_conflict` with `current`, `invalid_value` per field, `email_taken`, `team_inactive`, each `self_change_forbidden` action, each `staff_has_open_cases` reason with `caseIds`/`caseLanguage`, `last_admin`); effects (events in order; availability paused with `reason`; sessions ended with `revoked` and pending MFA challenges cancelled on deactivate and reset (login → reset → MFA and login → deactivate → reactivate → MFA answer `mfa_challenge_invalid`); no session change on a roles change; temporary password returned once, its hash stored, never in an event); idempotent creates (replay 200 + header + `temporaryPassword: null`; another body → `idempotency_conflict`); the races of §3.8 (two admins demoting each other; same email twice; deactivate a team vs move someone in: `version_conflict` then `team_not_empty`, or `team_inactive`).
- **Queries:** filters and both count sets of §4.1; `status` at a pinned clock (expired lock → `active`); `openCases` by language; `guards`; team counts.
- **Auth:** an inactive account's existing token is rejected (unchanged rule, now reachable); a role removed is effective on the next request (403 on a supervision route).
- **Supervision:** `TeamRef.id`/`TeamSummary.id` are team ids; renaming a team renames it in the overview; inactive analysts are not listed; `QueueDrainer` drains after languages are added to an available analyst.
- **Audit:** every new description of §7.1 (incl. both session suffixes and the changed availability/session texts); `family=administration` filter; the catalog test over the seeded log has no fallback.
- **Realtime:** `admin:directory` and `staff:<id>` access (admin / self only; customers never; bad keys → `invalid_topic`); `directory.updated` and `me.updated` triggers of §9.2 (one `me.updated` per member on `team.renamed`); `AccessTerminator` closes only that person's sockets with 4409 on a roles change; deactivation closes them with 4401; extra `team.updated`/`queue.updated` triggers.
- **Seed:** §11 (teams, Mariana locked, Andrés inactive, roster, the four admin events, slice 3 numbers unchanged).
- **OpenAPI:** new paths, schemas, codes and `ProblemDetails` members published; `export_openapi --check` clean.

**Frontend.** Every gate passes, including `check:api` after `gen:api`, plus:
- **`features/admin/model.test.ts`:** URL parse/serialize (unknown values fall back); `validateUserDraft` per field; `userGuardState` (self, last admin, open cases by language); `accountStatusAt` at a pinned `now`; `describeAdminFailure` per code and extension; `joinEs`; the draft diff and dirty detection (`ROLE_LABEL` is pinned in `app/roles.test.ts`).
- **Render tests:** users screen (rows with role chips and statuses, pills with counts, filters, empty with filters, error, aside of a locked and an inactive person, Valeria's own aside guards, open-case field errors, create → temporary password dialog with "Copiar", `version_conflict` resets the draft with the message, deactivate blocked by open cases with the supervision link only for a supervisor-admin); teams screen (pills, aside, rename, add member, deactivate disabled with members, `team_not_empty`); admin audit route (renders, "Ver la conversación" hidden for an admin without Supervisora); rail badge "Usuarios y roles, 1 pendiente"; guards test for the removed admin URLs.
- **Realtime / session:** `directory.updated` invalidations; `me.updated` updates the session user and the role switcher; the roles toast; `RealtimeClient` 4409 → immediate reconnect + listener; supervision tests with team ids.

**Done (live check on a fresh database, three browser windows: Valeria, Daniela, Felipe):**
- Valeria sees the badge 1, unlocks Mariana (badge 0, audit "Desbloqueó la cuenta de Mariana Duque"), and Mariana signs in with `demo1234`;
- she creates "Ana Gil" (Analista, portugués, Equipo Pacífico), copies the temporary password; Ana signs in (MFA `000000`), switches to "Disponible" and receives Gabriela's queued pt case (rule 3) — the S5 scenario;
- she removes Felipe's Supervisora role while he is on "Equipo y colas": his socket reconnects, the toast says "Ahora tienes: Analista.", he lands on "Casos"; she gives it back and the role switcher shows it again without signing in;
- she tries to deactivate Daniela → blocked by 5 open cases; Felipe (Supervisora again) reassigns them (the pt case to Sebastián or Tomás, rule 3), then the deactivation works, Daniela's window goes to `/login`, and her login answers "El correo o la contraseña no coinciden.";
- she cannot uncheck her own Administración or deactivate herself; two windows editing the same person → the second gets the `version_conflict` message with fresh data;
- she renames "Equipo Pacífico" → "Equipo Pacífico Sur": the supervision pill and the summary of its members (role switcher) update; deactivating "Equipo Andes" is refused (`team_not_empty`); a new empty team can be created, deactivated and reactivated;
- `/administracion/auditoria` and `/supervision/auditoria` show every step with Spanish descriptions under "Administración"; nothing breaks at 1280 px; no console errors.

## 13. Known gaps and seams (do not build now)

- No forced password change after a temporary password, no password policy, no self-service password change; the temporary password travels in the response body (dev-only, `Cache-Control: no-store`).
- The directory is not paginated (≤ 500 rows) and search runs in memory over the loaded rows.
- Deactivated or locked people get the same `invalid_credentials`/lock answers as before (anti-enumeration): the login screen never says "desactivada".
- An assignment racing a deactivation or a role/language removal may land on someone who just lost eligibility (§3.8): supervision reassigns it; no automatic sweep.
- Team renames do not rewrite old audit payloads (names are historical by design).
- No deletion of people or teams; no bulk moves between teams.
- The access-changed close (4409) reconnects every tab of that person, even for a role that changes no topic (cheap, accepted).
- `auth.session_ended` rows are entity `staff_session`, so the person's audit link (`?q=<STF-id>`) does not list the "Cerró la sesión de {P}" rows that a deactivation or a reset produces; the `staff.deactivated` / `staff.password_reset` rows already say "y cerró su sesión" / "sus {n} sesiones", and the rows are under Accesos.
- **Slice 5** (e2e): "admin creates an analyst, who then receives a case" and "lockout and unlock" use these screens; the temporary password is read from `TemporaryPasswordDialog`.

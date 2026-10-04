# Slice 11 contract · secure onboarding by invitation (part 4)

**Status:** implemented (2026-10-04). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-04.

**Scope.** User decision: "no tiene sentido si somos una empresa segura" — **administration never
sees or hands out a password**. The temporary-password flow of slice 4 (§3.1, §3.5, §10.3:
`temporaryPassword`, `TemporaryPasswordDialog`) is removed entirely and replaced by:

1. **Invitations by email.** "Nuevo usuario" → "Enviar invitación": the person is created
   `invited` (no password, cannot sign in) with an `Invitation` (single-use link, 48 h). With the
   link (`/activar?token=…`) she sets her own password and enrolls an authenticator app (TOTP,
   RFC 6238); then the account is active and starts En pausa. Administration can resend (new
   link, the old one stops working) or cancel the invitation.
2. **Password reset by email link.** "Restablecer contraseña" → "Enviar enlace para restablecer":
   a single-use link (1 h, `/restablecer?token=…`); her sessions end now; she sets the new password
   herself. Her second factor never changes there.
3. **TOTP at sign-in.** Every account created by an invitation signs in with the code of its own
   authenticator. The development code `000000` stays only for the **seeded** accounts that have
   no authenticator (and only outside production).
4. **Email delivery port** with a development adapter only: the **dev mailbox** (SQLite or memory,
   no external service), listed by `GET /api/v1/dev/mailbox` and the SPA page `/dev/correos`
   while `CC_DEV_MAILBOX` is on (never in production).

People-only, as every slice: no AI, fixed templates.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-4-administration.md` (everything not
changed here still holds), `slice-10-notifications.md` (`invitation_accepted`), `../DATA_MODEL.md`.
Design: canvas `Admin.dc.html` (views `nuevo`, `invitacion`, `pendiente`), `BoActivar.dc.html`
(views `activar`, `verificacion`, `lista`, `vencido`) and `BoLogin` / `BoMfa`.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Who knows a password | Only its owner. No API response, email, event or log carries a password, a token or a TOTP secret (the dev mailbox holds the links, development only). | User decision; slice 4 handed passwords out in a response body. |
| Invitation model | Its own aggregate `Invitation` (`INV-…`), **one per person** (`staff_id` unique): resend replaces the token; a cancelled one is reissued when the same email is invited again. States stored: `pending`, `accepted`, `cancelled`; `expired` is derived (`pending` past `expires_at`). | "One pending invitation per person" holds by construction; resend invalidates the old link atomically (one row, CAS). |
| The person before activation | `Staff.setup = invited` (`active` false: no case, no supervision row, no notification, no admin roster); `withdrawn` after a cancel (hidden from the directory, email reusable: "Nuevo usuario" with it invites the same record again); `complete` once activated (or seeded). | The slice 4 rules for active people stay untouched; an invited person cannot sign in (no login account: same answer as an unknown email). |
| Tokens | `secrets.token_urlsafe(32)` (256 bits); only the SHA-256 is stored (indexed lookup); single use. Tokens travel in **POST bodies** (`/onboarding/*`), never in API URLs, so access logs and proxies never see them (the SPA URL `/activar?token=` is the email link). | A GET with the token in the query string would leak it into server logs. |
| Generic answers | Unknown, expired, used and cancelled tokens all answer **410 `link_invalid`** ("El enlace venció o ya se usó."), never who it was for. A valid token proves possession: the check shows her name, email, roles and team (the welcome line). | No account enumeration beyond what the token proves. |
| Rate limit | Like the login's unknown-email counters: a process-local `FailedAttemptCounter` per client address (`link:<host>`). 10 unusable links lock the onboarding routes for that client 15 minutes (**429 `rate_limited`**, `unlockAt`), valid links included. Wrong enrollment codes count **on the invitation** with the login lockout (5 → 15 min, **423 `account_locked`**). | 256-bit tokens are not guessable; the counters cap automated probing and code guessing with a stolen link. |
| Password policy | Server-side (`domain/people/password_policy.py`), NIST 800-63B style: ≥ 12 characters (≤ 128), not containing her email name (or a piece of it of 3+ letters) nor a word of her name (3+ letters), accents and case ignored, not in a short block list. **422 `password_rejected`** with `reasons`. The SPA mirrors the same rules live. | Spec; canvas `BoActivar` rules. |
| Hashing | Argon2id, as the login. | Unchanged. |
| TOTP | `pyotp` (RFC 6238: 30 s, 6 digits, HMAC-SHA1 for authenticator compatibility), one step of drift accepted, codes checked against the injected `Clock`. The secret (160 bits) is shown **once** (QR from the `otpauth://` URI + manual key) and stored **sealed** (Fernet, `cryptography`) on the login account; never returned again. | Spec ("encrypted or at least not exposed again"). |
| Sealing key | `CC_TOTP_SECRET_KEY` (a Fernet key). Unset in dev/test: derived from the session secret (so a local database keeps working across restarts). Production refuses to start without it. | Documented dev choice; rotation (`MultiFernet`) is a seam. |
| Two-step activation | Step 1 stores her password hash and a sealed secret **on the invitation**; step 2 (the code) creates the login account with both, activates her and uses the link up. Sending a password again starts over with a new secret (the failure counter is kept). A reload goes back to step 1. | The secret is never re-exposed; abandoning after step 1 leaves nothing active. |
| Reset link | Its own aggregate `PasswordReset` (`PWR-…`), one row per person (a new link replaces the token), 1 hour. Sending it ends her sessions and pending sign-ins now and clears a lock (canvas copy). Her current password keeps working until she sets the new one (asking for a link cannot lock anyone out). Completing it ends any session again and cancels pending MFA challenges. | Spec ("ends the person's sessions immediately"); a reset link alone cannot take over an account with an authenticator. |
| Self-service "Olvidé mi contraseña" | **Not built.** "¿La olvidaste?" on the login explains that Administración sends the link (canvas `BoLogin` toast). | Canvas decision; a self-service request needs its own enumeration-safe throttling and is out of the cheap path. Documented gap. |
| Email | `EmailSender` port; development adapter = dev mailbox (table `dev_mailbox` or memory, newest 200). Emails are sent **after** the Unit of Work commits; a failed delivery leaves the invitation without its email (resend fixes it). No production adapter: `CC_ENV=prod` refuses to start. | Spec. |
| Dev mailbox exposure | `CC_DEV_MAILBOX` unset = on only with `CC_ENV=dev`; the browser e2e turns it on with `CC_ENV=test`; production refuses it. The route always exists in OpenAPI and answers 404 while off. `GET /meta` says `devMailbox`. | OpenAPI must not depend on settings (`export_openapi --check`). |
| Seeded dev accounts | Keep `demo1234` + `000000` (no authenticator). Tatiana Rojas (seeded as an accepted invitation) has an authenticator with the documented key `JBSWY3DPEHPK3PXP`; Bruna Esteves is a pending invitation. | Spec. |

## 2. Domain

### 2.1 `Invitation` (`domain/people/invitation.py`)

```
Invitation(id INV-…, staff_id, token_hash, created_at, sent_at, expires_at (= sent_at + 48 h),
           created_by, state pending|accepted|cancelled, resend_count, accepted_at?,
           cancelled_at?, password_hash?, totp_secret? (sealed), failed_codes, locked_until?)
```

| Method | Rule | Event (`entity = staff`, `entity_id` = her id) |
|---|---|---|
| `send(...)` | new, pending | `staff.invitation_sent {invitation_id, expires_at}` (actor: the admin) |
| `resend(hash, now, actor, ttl)` | pending (expired too) → new token, `sent_at`, `expires_at`; `resend_count + 1`; enrollment cleared | `staff.invitation_resent {invitation_id, expires_at, resend_count}` |
| `cancel(now, actor)` | pending (expired too) → cancelled; enrollment cleared | `staff.invitation_cancelled {invitation_id}` |
| `reissue(hash, now, actor, ttl)` | cancelled → pending (invited again) | `staff.invitation_sent` |
| `start_enrollment(password_hash, totp_secret, now)` | usable (pending, not expired) | — |
| `ensure_can_try_code(now)` / `register_wrong_code(now, policy)` | `FailedAttemptCounter` (5 → 15 min) | — (security counter) |
| `accept(now, actor)` | usable and enrollment started → accepted; enrollment cleared | `staff.invitation_accepted {invitation_id}` (actor: herself) |

Anything else is `InvalidTransitionError` (409 `invalid_transition`).

### 2.2 `PasswordReset` (`domain/people/password_reset.py`)

`PasswordReset(id PWR-…, staff_id, token_hash, sent_at, expires_at (= + 1 h), created_by, state
pending|used, used_at?)`. `issue` / `reissue` record `staff.password_reset_link_sent {reset_id,
expires_at, revoked_sessions, cleared_lock}` (actor: the admin); `use(now)` once (no event).

### 2.3 `Staff`, `LoginAccount`

- `Staff.setup: AccountSetup = invited | withdrawn | complete` (invariant: only `complete` may be
  `active`). `Staff.create` makes an **invited** person. `activate(team)` (her team active),
  `withdraw()`, `reinvite(creation_key)`. `reactivate` of a person who never activated →
  `StaffInvitedError` (409 `staff_invited`). `is_member` = active or invited (team counts).
- `LoginAccount.totp_secret` (sealed; `None` only for seeded dev accounts). `LoginAccount.open(...)`
  records `staff.mfa_enrolled {method: "totp"}` (actor: herself). `clear_attempts(now)` (the link
  was sent). `reset_password(hash, now, actor)` records `staff.password_reset {cleared_lock}`
  (**actor: herself** now; slice 4's admin-issued variant is gone).

### 2.4 Event order of an activation

`staff.mfa_enrolled` then `staff.invitation_accepted` (one Unit of Work). The notification
projector maps `staff.invitation_accepted` to `invitation_accepted` for every active
Administración but her (slice 10 §3).

## 3. Use cases

Administration (`application/people/admin/commands.py`, every rule of slice 4 §3 still applies:
fresh admin, CAS, `retry_on_conflict`):

| Command | Route | Rules in order |
|---|---|---|
| `CreateUser` | `POST /admin/users` | actor · `Idempotency-Key` replay (200, no new email) · the person (`invalid_value`) · email free (`email_taken`; a **withdrawn** person's email is invited again: same id, profile edits recorded, `reissue`) · team exists / active. Creates `Staff` (invited) + `Invitation`; emails the link after commit. |
| `ResendInvitation` | `POST /admin/users/{id}/invitation/resend` | actor · 404 · she is invited with an invitation (else 409 `invalid_transition`) |
| `CancelInvitation` | `POST /admin/users/{id}/invitation/cancel` | same; `Invitation.cancel` + `Staff.withdraw` |
| `SendPasswordResetLink` | `POST /admin/users/{id}/password-reset` | actor · 404 · not herself (422 `self_change_forbidden`, `reset_own_password`) · not invited / withdrawn (409 `staff_invited`) · active (409 `staff_inactive`). Clears the lock, issues or reissues the link, ends her sessions and pending challenges, emails the link after commit. Not idempotent. |
| `ReactivateUser` | (slice 4) | + 409 `staff_invited` for someone who never activated |

Public (`application/people/onboarding/commands.py`; each first asks `LinkGuard`, then looks the
token up by hash):

| Use case | Route | Answers |
|---|---|---|
| `CheckInvitation` | `POST /onboarding/invitations/check {token}` | `InvitationCheck` · 410 · 429 |
| `SetInvitationPassword` | `POST /onboarding/invitations/password {token, password}` | `TotpEnrollment` · 410 · 422 `password_rejected` · 429 |
| `ActivateInvitation` | `POST /onboarding/invitations/activate {token, code}` | `ActivatedAccount` · 409 `invalid_transition` (no password yet) · 410 · 422 `totp_invalid` (`remainingAttempts`) · 423 `account_locked` · 429 |
| `CheckPasswordReset` | `POST /onboarding/password-resets/check {token}` | `PasswordResetCheck` · 410 · 429 |
| `CompletePasswordReset` | `POST /onboarding/password-resets/complete {token, password}` | `PasswordResetDone` · 410 · 422 · 429 |
| `ListDevMailbox` | `GET /dev/mailbox?limit=1–50` | `DevMailbox` · 404 when off |

A reset link of a person deactivated meanwhile is unusable (410). `VerifyMfa` (sign-in): her
authenticator when she has one (`TotpService.verify` at the clock), else the dev verifier (seeded
accounts), never both; no dev verifier outside dev/test.

## 4. REST API

### 4.1 Schemas (camelCase, members always present)

```ts
InvitedUser { user: AdminUser }                                   // was CreatedUser
PasswordResetLinkSent { user: AdminUser; revokedSessions: int; expiresAt }   // was PasswordResetResult
AdminUser += { invitation: AdminInvitation | null; secondFactor: 'totp' | 'dev_code' | null }
AdminInvitation { id; status: 'pending'|'expired'|'accepted'|'cancelled'; createdAt; sentAt; expiresAt; resendCount }
AccountStatus = active | locked | invited | inactive | cancelled   // cancelled: never listed
UserStatusFilter += invited;  UserStatusCounts += invited

InvitationCheck { name; email; roles: StaffRole[]; teamName; expiresAt; passwordRules: PasswordRules }
PasswordRules { minLength: 12; maxLength: 128; rules: ('min_length'|'personal_info'|'common')[] }
TotpEnrollment { otpauthUri; secret; accountName; issuer; digits: 6; periodSeconds: 30 }
ActivatedAccount { name; email }
PasswordResetCheck { name; email; expiresAt; passwordRules }
PasswordResetDone { email; revokedSessions }
DevMailbox { items: DevEmail[] }   DevEmail { id; kind: 'invitation'|'password_reset'; to; subject; text; link; sentAt }
MetaResponse += { devMailbox: boolean }
```

Request bodies reject unknown fields. `ProblemDetails` gains `reasons: PasswordRule[]`.

### 4.2 Problem codes (new)

| Code | Status | Default detail | Extensions |
|---|---|---|---|
| `staff_invited` | 409 | "Esta persona todavía no activó su cuenta. Reenvía la invitación." | — |
| `link_invalid` | 410 | "El enlace venció o ya se usó." | — |
| `rate_limited` | 429 | "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." | `unlockAt` |
| `password_rejected` | 422 | "La contraseña no cumple los requisitos." | `reasons` |
| `totp_invalid` | 422 | "El código no coincide. Escribe el código que muestra ahora tu app." | `remainingAttempts` |

`totp_invalid` is 422 (not 401): a signed-in tab that opens a link keeps its own session.

### 4.3 Realtime

No new envelope. The new `staff.*` events belong to `STAFF_ADMIN_EVENTS`: `directory.updated`
(`admin:directory`, ids only; activation and creation name her team) and the supervision
`team.updated` / `queue.updated` signals of slice 4 §9.2 (an activated analyst appears in Equipo).
Sending a reset link ends sessions → `SessionTerminator` closes her sockets (4401).

## 5. Audit (catalog additions)

| Event | Family | Description |
|---|---|---|
| `staff.invitation_sent` | administration | "Invitó a {P} por correo" |
| `staff.invitation_resent` | administration | "Reenvió la invitación a {P}" |
| `staff.invitation_cancelled` | administration | "Canceló la invitación de {P}" |
| `staff.password_reset_link_sent` | administration | "Le envió a {P} un enlace para restablecer la contraseña" + " y cerró su sesión" / " y cerró sus {n} sesiones" |
| `staff.invitation_accepted` | access (actor: herself) | "Aceptó la invitación y activó su cuenta" |
| `staff.mfa_enrolled` | access (actor: herself) | "Configuró la verificación en dos pasos" |
| `staff.password_reset` | access (actor: herself) | "Creó una contraseña nueva con el enlace de restablecimiento" |

Payloads never carry an email, a token, a password or a secret (the guard test covers them).

## 6. Emails (neutral Spanish, fixed templates)

- **Invitation** — subject "Te invitaron a la Plataforma CC de LATAM Bank"; body: greeting with
  her first name, "Administración te invitó … con el rol de {roles} en {equipo}", the link, "El
  enlace vence en 48 horas y sirve una sola vez. Nadie del banco conoce tu contraseña ni te la va
  a pedir.", "Si no esperabas esta invitación, ignora este correo."
- **Password reset** — subject "Crea una contraseña nueva para la Plataforma CC"; the link, "El
  enlace vence en 1 hora y sirve una sola vez. Tu verificación en dos pasos no cambia.", "Si no lo
  pediste, avisa a administración."

## 7. Frontend

- **Admin** (`features/admin`): "Nuevo usuario" submits with "Enviar invitación"; success opens
  "Invitación enviada" ("Invitación enviada a {correo}. El enlace vence en 48 horas."). Status
  "Invitación pendiente" (dashed ring, accent); the panel of an invited person shows "Invitación
  enviada" / "Vence" (or "Venció") / "Último ingreso: Nunca" and the actions "Reenviar invitación"
  and "Cancelar invitación" (confirm dialog). "Enviar enlace para restablecer" (confirm dialog:
  the email, sessions end now, a lock is cleared, nobody sees the new password). No password is
  ever displayed; `TemporaryPasswordDialog` is gone.
- **Public routes** (outside the staff shell and outside `GuestOnly`, same look as the login):
  `/activar?token=` (step indicator "Contraseña" → "Verificación en dos pasos"; live rules; QR
  rendered from `otpauthUri` with `qrcode-generator` pinned; manual key in mono with "Copiar"; the
  6-digit `CodeInput`; "Tu cuenta está lista" → "Entrar"; "El enlace venció o ya se usó" with "Pide
  una nueva invitación a administración") and `/restablecer?token=` (password, then "Contraseña
  actualizada").
- **Dev mailbox** `/dev/correos` (only when `/meta` says `devMailbox`), linked from the login
  footer in that case; clearly marked as a development tool.

## 8. Seed

| Person | State | Story |
|---|---|---|
| Tatiana Rojas (`tatiana.rojas@`, Analista, español, Equipo Andes, STF-…14) | active, authenticator | Valeria invited her at T−2d; she accepted at T−1h (`staff.mfa_enrolled`, `staff.invitation_accepted`): Valeria and Carolina have "Invitación aceptada: Tatiana Rojas" (read: older than 30 min). Password `demo1234`; TOTP key `JBSWY3DPEHPK3PXP` (no dev code). |
| Bruna Esteves (`bruna.esteves@`, Analista, portugués, Equipo Andes, STF-…15) | invited, pending | Valeria invited her at T−3h; the link expires at T+45h. Her email (with a fresh link) is in the dev mailbox after the first start. |

Every other seeded account keeps `demo1234` + `000000`. Directory on a fresh database: 15 listed
(13 active incl. Tatiana and the locked Mariana, 1 invited, 1 inactive); Equipo Andes counts 6
members / 5 analysts (invited people count as members); supervision lists Tatiana (7 Spanish
speakers).

## 9. Tests

Backend: `tests/unit/domain/test_onboarding.py` (invitation states, resend, cancel / reissue,
single use, the enrollment lockout, reset links, the password policy, the staff setup,
`LoginAccount.open`); `tests/unit/application/test_onboarding.py` (both flows end to end, the seed,
TOTP vs dev code at sign-in, drift with a fixed clock, expiry, resend invalidates, cancel and
re-invite, enumeration-safe answers, the rate limit, the dev mailbox);
`tests/unit/infrastructure/test_onboarding_adapters.py` (repositories on both stores, dev mailbox,
RFC 6238 vectors, secret box, tokens); `tests/api/test_onboarding_api.py` (routes, problem shapes,
429 / 423, the directory signal, dev mailbox off → 404, production settings refuse it); slice 4
admin tests rewritten for invitations and reset links. Frontend and e2e: see
`frontend/ARCHITECTURE.md` (the admin e2e scenario: invite → dev mailbox → activation with TOTP →
sign in → receives a case).

## 10. Known gaps

- No production email adapter (SMTP / provider): `CC_ENV=prod` refuses to start.
- No self-service "Olvidé mi contraseña"; no administration reset of a lost authenticator ("Si
  cambias de teléfono, pide ayuda a administración" has no tool yet: today it means a new account).
- TOTP codes are not remembered after use (a code can be replayed inside its ~1-minute window);
  no backup codes.
- The rate-limit counters are process-local (a restart or a second worker resets them) and keyed
  by the client address uvicorn sees (configure `--forwarded-allow-ips` behind a proxy).
- Email delivery is not transactional (sent after the commit; a crash in between leaves an
  invitation without its email: resend it).
- The dev mailbox stores links in clear (development only) and keeps 200 messages.
- No migration: delete `backend/cc_platform.db` (new tables and columns).

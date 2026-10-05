"""Table definitions (SQLAlchemy Core). Domain objects are mapped explicitly in repositories,
so the domain stays free of persistence concerns.

Only portable types are used (no SQLite-only SQL). Schema is created with
``metadata.create_all`` at startup; Alembic migrations are a known gap (see README).
"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)

from cc_platform.infrastructure.persistence.sqlalchemy.types import UtcDateTime

ID = 40

VERSION_COLUMN = "version"


def _version() -> Column[int]:
    """Optimistic-locking revision (see ``AggregateRoot.version``); bumped on every save."""
    return Column(VERSION_COLUMN, Integer, nullable=False, default=1)


metadata = MetaData(
    naming_convention={
        "ix": "ix_%(table_name)s_%(column_0_N_name)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }
)

# Slice 4: teams are records. ``name_key`` (case- and accent-insensitive name) is unique among
# all teams; ``creation_key`` is the ``Idempotency-Key`` of the create.
teams = Table(
    "teams",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("name", String(80), nullable=False),
    Column("name_key", String(80), nullable=False, unique=True),
    Column("active", Boolean, nullable=False),
    Column("created_at", UtcDateTime, nullable=False),
    Column("creation_key", String(64), nullable=True, unique=True),
    _version(),
)

staff = Table(
    "staff",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("email", String(320), nullable=False, unique=True),
    Column("roles", JSON, nullable=False),
    Column("languages", JSON, nullable=False),
    Column("team_id", String(ID), ForeignKey("teams.id"), nullable=False, index=True),
    Column("active", Boolean, nullable=False, default=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("creation_key", String(64), nullable=True, unique=True),
    # Part 4: ``invited`` (pending invitation, no password) · ``withdrawn`` (cancelled
    # before activation; hidden) · ``complete`` (activated or seeded). See ``AccountSetup``.
    Column("setup", String(20), nullable=False, default="complete"),
    _version(),
)

# Singleton (``id = "default"``): the active admins, serialising "at least one admin".
admin_roster = Table(
    "admin_roster",
    metadata,
    Column("id", String(20), primary_key=True),
    Column("admin_ids", JSON, nullable=False),
    _version(),
)

# Singleton (``id = "default"``, slice 18): platform-wide settings (the AI switch). Absent until
# Administración changes a switch: the deployment default (``CC_AI_ENABLED``) applies.
platform_settings = Table(
    "platform_settings",
    metadata,
    Column("id", String(20), primary_key=True),
    Column("ai_enabled", Boolean, nullable=False),
    Column("updated_at", UtcDateTime, nullable=True),
    Column("updated_by_id", String(ID), nullable=True),
    _version(),
)

login_accounts = Table(
    "login_accounts",
    metadata,
    Column("staff_id", String(ID), ForeignKey("staff.id"), primary_key=True),
    Column("password_hash", String(255), nullable=False),
    Column("failed_attempts", Integer, nullable=False, default=0),
    Column("locked_until", UtcDateTime, nullable=True),
    Column("last_login_at", UtcDateTime, nullable=True),
    # Part 4: her authenticator's RFC 6238 secret, sealed (Fernet). NULL only for the seeded
    # development accounts (they use the dev code).
    Column("totp_secret", String(512), nullable=True),
    _version(),
)

# Part 4: one invitation per person (``staff_id`` unique). Only the SHA-256 hash of the
# single-use link token is stored. ``state`` is pending | accepted | cancelled (expired is
# derived from ``expires_at``). ``password_hash`` / ``totp_secret`` (sealed) hold an
# enrollment in progress, between her password and her first code.
invitations = Table(
    "invitations",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False, unique=True),
    Column("token_hash", String(128), nullable=False, unique=True),
    Column("state", String(20), nullable=False),
    Column("created_at", UtcDateTime, nullable=False),
    Column("sent_at", UtcDateTime, nullable=False),
    Column("expires_at", UtcDateTime, nullable=False),
    Column("created_by", String(ID), nullable=False),
    Column("resend_count", Integer, nullable=False, default=0),
    Column("accepted_at", UtcDateTime, nullable=True),
    Column("cancelled_at", UtcDateTime, nullable=True),
    Column("password_hash", String(255), nullable=True),
    Column("totp_secret", String(512), nullable=True),
    Column("failed_codes", Integer, nullable=False, default=0),
    Column("locked_until", UtcDateTime, nullable=True),
    _version(),
)

# Part 4: one password-reset link per person (a new link replaces the token). Only the
# token's hash is stored; ``state`` is pending | used (expired is derived).
password_resets = Table(
    "password_resets",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False, unique=True),
    Column("token_hash", String(128), nullable=False, unique=True),
    Column("state", String(20), nullable=False),
    Column("sent_at", UtcDateTime, nullable=False),
    Column("expires_at", UtcDateTime, nullable=False),
    Column("created_by", String(ID), nullable=False),
    Column("used_at", UtcDateTime, nullable=True),
    _version(),
)

# Part 4, development only: what the dev ``EmailSender`` "sent" (``GET /dev/mailbox`` while
# ``CC_DEV_MAILBOX`` is on). Never written in production (no dev adapter there).
dev_mailbox = Table(
    "dev_mailbox",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("kind", String(20), nullable=False),
    Column("to_address", String(320), nullable=False),
    Column("subject", String(200), nullable=False),
    Column("text", Text, nullable=False),
    Column("link", String(1000), nullable=False),
    Column("sent_at", UtcDateTime, nullable=False),
    Index("ix_dev_mailbox_sent", "sent_at", "id"),
)

mfa_challenges = Table(
    "mfa_challenges",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False, index=True),
    Column("issued_at", UtcDateTime, nullable=False),
    Column("expires_at", UtcDateTime, nullable=False),
    Column("max_attempts", Integer, nullable=False),
    Column("attempts", Integer, nullable=False, default=0),
    Column("status", String(20), nullable=False),
    Column("verified_at", UtcDateTime, nullable=True),
    Column("method", String(20), nullable=True),
    _version(),
)

staff_sessions = Table(
    "staff_sessions",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False, index=True),
    Column("issued_at", UtcDateTime, nullable=False),
    Column("expires_at", UtcDateTime, nullable=False),
    Column("mfa_method", String(20), nullable=False),
    Column("ended_at", UtcDateTime, nullable=True),
    Column("end_reason", String(20), nullable=True),
    _version(),
)

analyst_availability = Table(
    "analyst_availability",
    metadata,
    Column("staff_id", String(ID), ForeignKey("staff.id"), primary_key=True),
    Column("status", String(20), nullable=False),
    Column("since", UtcDateTime, nullable=False),
    _version(),
)

# Slice 23: a person's own settings (the UI language). Absent = the defaults (``es``).
staff_preferences = Table(
    "staff_preferences",
    metadata,
    Column("staff_id", String(ID), ForeignKey("staff.id"), primary_key=True),
    Column("ui_language", String(10), nullable=False),
    _version(),
)

# Minimal customer profile (seeded "Datos de ejemplo"; no use case writes it yet).
customers = Table(
    "customers",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("display_name", String(200), nullable=False),
    Column("country", String(2), nullable=False),
    Column("city", String(120), nullable=False),
    Column("locale", String(10), nullable=False),
    Column("simulator", Boolean, nullable=False, default=False),
    Column("suggestions", JSON, nullable=False),
)

cases = Table(
    "cases",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("customer_id", String(ID), ForeignKey("customers.id"), nullable=False),
    Column("channel", String(20), nullable=False),
    Column("language", String(5), nullable=False),
    Column("priority", String(10), nullable=False),
    # slice 18: what the case is about (a dataset complaint subcategory, or none)
    Column("case_type", String(30), nullable=False, default="none"),
    Column("status", String(20), nullable=False),
    Column("opened_at", UtcDateTime, nullable=False),
    Column("sla_due_at", UtcDateTime, nullable=False),
    Column("first_response_at", UtcDateTime, nullable=True),
    Column("search_text", String(400), nullable=False),
    Column("previous_case_id", String(ID), nullable=True),
    Column("assigned_analyst_id", String(ID), ForeignKey("staff.id"), nullable=True),
    Column("assigned_at", UtcDateTime, nullable=True),
    Column("queued_at", UtcDateTime, nullable=True),
    Column("queue_label", String(120), nullable=True),
    Column("last_sequence", Integer, nullable=False, default=0),
    Column("last_public_sequence", Integer, nullable=False, default=0),
    Column("last_message_at", UtcDateTime, nullable=True),
    Column("last_message_author_role", String(20), nullable=True),
    Column("last_message_preview", String(400), nullable=True),
    Column("last_turn_author_role", String(20), nullable=True),
    Column("last_turn_preview", String(400), nullable=True),
    Column("assignee_read_sequence", Integer, nullable=False, default=0),
    Column("unread_sequences", JSON, nullable=False),
    # closure (flattened)
    Column("closed_at", UtcDateTime, nullable=True),
    Column("closed_by_id", String(120), nullable=True),
    Column("closed_by_role", String(20), nullable=True),
    Column("close_reason", String(30), nullable=True),
    Column("close_note", String(500), nullable=True),
    # customer rating (slice 7, flattened): 1–4, optional comment, the Idempotency-Key
    Column("rating_score", Integer, nullable=True),
    Column("rating_comment", String(500), nullable=True),
    Column("rated_at", UtcDateTime, nullable=True),
    Column("rating_key", String(64), nullable=True),
    # slice 9: the escalation to supervision that is open now (one per case at a time)
    Column("open_escalation_id", String(ID), nullable=True),
    # slice 12: the call that is ringing or connected now (one per case at a time)
    Column("active_call_id", String(ID), nullable=True),
    _version(),
    Index("ix_cases_assignee_status", "assigned_analyst_id", "status"),
    Index("ix_cases_assignee_closed", "assigned_analyst_id", "closed_at"),
    Index("ix_cases_status_opened", "status", "opened_at"),
    Index("ix_cases_customer_opened", "customer_id", "opened_at"),
    # "Calificación 7 días" (slice 7): the rated cases each analyst closed since a time.
    Index("ix_cases_closer_closed", "closed_by_id", "closed_at"),
    # "Colas" (slice 9): every open case of one language.
    Index("ix_cases_language_status", "language", "status"),
)

# Append-only transcript. (case_id, sequence) is gap-free per case (the case CAS
# serialises it); (author_id, client_message_id) dedupes retried messages.
turns = Table(
    "turns",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("kind", String(20), nullable=False),
    Column("audience", String(20), nullable=False),
    Column("author_role", String(20), nullable=False),
    Column("author_id", String(120), nullable=True),
    Column("text", Text, nullable=False),
    Column("language", String(5), nullable=False),
    Column("created_at", UtcDateTime, nullable=False),
    Column("client_message_id", String(64), nullable=True),
    # slice 12: the subject of an ``email`` turn (null on every other kind)
    Column("subject", String(200), nullable=True),
    # slice 23c: the facts of a staff-only line (``{kind, params}``; null on every other turn
    # and on routing banners written before 23c, which show their stored text)
    Column("staff_line", JSON, nullable=True),
    UniqueConstraint("case_id", "sequence", name="uq_turns_case_sequence"),
    UniqueConstraint("author_id", "client_message_id", name="uq_turns_author_client_message"),
)

assignments = Table(
    "assignments",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False, index=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False),
    Column("reason", String(40), nullable=False),
    Column("policy_rule_id", String(20), nullable=True),
    Column("open_cases_at_assignment", Integer, nullable=False),
    Column("strategy", String(80), nullable=False),
    Column("assigned_at", UtcDateTime, nullable=False),
    Column("assigned_by_role", String(20), nullable=False),
    Column("assigned_by_id", String(120), nullable=False),
    Column("waited_seconds", Integer, nullable=True),
    # Slice 3: who held the case before a reassignment, and a paused target confirmed.
    Column("previous_staff_id", String(ID), nullable=True),
    Column("paused_override", Boolean, nullable=False, default=False),
    # "held a case of this customer" (history access) also looks at past assignments.
    Index("ix_assignments_staff_case", "staff_id", "case_id"),
    # Analyst home (slice 6): cases assigned to her, or taken away from her, since a time.
    Index("ix_assignments_staff_assigned", "staff_id", "assigned_at"),
    Index("ix_assignments_previous_staff_assigned", "previous_staff_id", "assigned_at"),
)

# Slice 9: escalations to supervision. One row per escalation (a case may be escalated again
# after one ends); the open one is also pointed to by ``cases.open_escalation_id``.
escalations = Table(
    "escalations",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False),
    Column("state", String(20), nullable=False),
    Column("motive", String(500), nullable=False),
    Column("escalated_by_id", String(ID), ForeignKey("staff.id"), nullable=False),
    Column("escalated_at", UtcDateTime, nullable=False),
    Column("resolved_at", UtcDateTime, nullable=True),
    Column("resolved_by_id", String(ID), nullable=True),
    Column("note", String(500), nullable=True),
    Column("reassigned_to_id", String(ID), nullable=True),
    Column("acknowledged_at", UtcDateTime, nullable=True),
    Column("creation_key", String(64), nullable=True, unique=True),
    _version(),
    Index("ix_escalations_case_escalated", "case_id", "escalated_at"),
    # "Escalados": the open ones, and the ones attended since a time.
    Index("ix_escalations_state_escalated", "state", "escalated_at"),
    Index("ix_escalations_resolved", "resolved_at"),
)

# Slice 12: simulated phone calls (no telephony). One row per call; the active one is also
# pointed to by ``cases.active_call_id``. ``holds`` is the list of hold intervals (JSON:
# ``[{"started_at", "ended_at"}]``); the transcript lives in ``turns`` (kind ``transcript``).
calls = Table(
    "calls",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False),
    Column("customer_id", String(ID), ForeignKey("customers.id"), nullable=False),
    Column("direction", String(10), nullable=False),
    Column("state", String(10), nullable=False),
    Column("reason", String(500), nullable=True),
    Column("analyst_id", String(ID), nullable=True),
    Column("started_at", UtcDateTime, nullable=False),
    Column("answered_at", UtcDateTime, nullable=True),
    Column("ended_at", UtcDateTime, nullable=True),
    Column("end_reason", String(20), nullable=True),
    Column("ended_by_role", String(20), nullable=True),
    Column("muted", Boolean, nullable=False, default=False),
    Column("holds", JSON, nullable=False),
    Column("creation_key", String(64), nullable=True, unique=True),
    _version(),
    Index("ix_calls_case_started", "case_id", "started_at"),
)

# ADR 0003: the conversation a case holds with the agent (agent-core). One per case that
# opened in the agent's hands. ``claim``, ``queued`` and ``blocked`` are the inputs of
# ``AgentInput`` (JSON: ``{kind, turn_id, sequence, token, answer, attempt}``); ``confirmation``
# and ``step_up`` are what the agent waits for. No message text is stored here.
assistant_sessions = Table(
    "assistant_sessions",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False, unique=True),
    Column("customer_id", String(ID), ForeignKey("customers.id"), nullable=False),
    Column("entry_agent", String(120), nullable=False),
    Column("state", String(12), nullable=False),
    Column("agent", String(120), nullable=True),
    Column("agent_session_id", String(120), nullable=True),
    Column("run_id", String(120), nullable=True),
    # the agent release the run started on (engine signals: outcome attribution)
    Column("agent_release", String(120), nullable=True),
    Column("awaiting", String(20), nullable=False),
    Column("confirmation", JSON, nullable=True),
    Column("step_up", JSON, nullable=True),
    Column("step_up_verified_at", UtcDateTime, nullable=True),
    Column("step_up_attempts", Integer, nullable=False, default=0),
    Column("processed_sequence", Integer, nullable=False, default=0),
    Column("claim", JSON, nullable=True),
    Column("claimed_at", UtcDateTime, nullable=True),
    Column("queued", JSON, nullable=True),
    Column("blocked", JSON, nullable=True),
    Column("resend_blocked", Boolean, nullable=False, default=False),
    Column("handoff_ref", String(120), nullable=True),
    Column("handoff_resolved_at", UtcDateTime, nullable=True),
    Column("failure_code", String(60), nullable=True),
    Column("last_trace_id", String(120), nullable=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("updated_at", UtcDateTime, nullable=False),
    _version(),
    Index("ix_assistant_sessions_state_updated", "state", "updated_at"),
)

# ADR 0003 (slice 15): an analyst's conversation with the copilot about one case. ``messages`` is a
# JSON list (``[{id, role, text, created_at, client_message_id, answers}]``, newest 200).
copilot_threads = Table(
    "copilot_threads",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False),
    Column("analyst_id", String(ID), ForeignKey("staff.id"), nullable=False),
    Column("agent", String(120), nullable=False),
    Column("agent_session_id", String(120), nullable=True),
    Column("run_id", String(120), nullable=True),
    Column("runs", Integer, nullable=False, default=0),
    Column("messages", JSON, nullable=False),
    Column("last_trace_id", String(120), nullable=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("updated_at", UtcDateTime, nullable=False),
    _version(),
    UniqueConstraint("case_id", "analyst_id", name="uq_copilot_threads_case_analyst"),
)

# ADR 0005: what the copilot proposed for a case (one agent-core run) and what the analyst did with
# it. ``items`` holds the texts (draft, motive, evidence, tool ids) and is cleared by the purge, 24
# hours at most; what stays is ``kinds``, ``tool_ids``, ``reply_hash`` and the decisions.
copilot_suggestions = Table(
    "copilot_suggestions",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False),
    Column("analyst_id", String(ID), ForeignKey("staff.id"), nullable=False),
    Column("agent", String(120), nullable=False),
    Column("trigger", String(30), nullable=False),
    Column("status", String(20), nullable=False),
    Column("based_on_sequence", Integer, nullable=False),
    Column("request_key", String(80), nullable=True),
    Column("items", JSON, nullable=False),
    Column("kinds", JSON, nullable=False),
    Column("tool_ids", JSON, nullable=False),
    Column("reply_hash", String(64), nullable=True),
    Column("reply_decision", String(20), nullable=True),
    Column("edit_distance_permille", Integer, nullable=True),
    Column("escalation_accepted", Boolean, nullable=False, default=False),
    Column("truncated", Boolean, nullable=False, default=False),
    Column("run_id", String(120), nullable=True),
    Column("trace_id", String(120), nullable=True),
    Column("release", String(120), nullable=True),
    Column("failure_code", String(60), nullable=True),
    Column("purged_at", UtcDateTime, nullable=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("updated_at", UtcDateTime, nullable=False),
    _version(),
    UniqueConstraint(
        "case_id", "analyst_id", "request_key", name="uq_copilot_suggestions_case_analyst_key"
    ),
    Index("ix_copilot_suggestions_case_analyst_created", "case_id", "analyst_id", "created_at"),
    Index("ix_copilot_suggestions_status_created", "status", "created_at"),
)

# Slice 21 (ADR 0006): how far the AI matured for each case type. One row per type, created the
# first time something happens to it (absent = stage 0). ``signals`` is a JSON object (the
# counters since the current stage, ``StageSignals``); ``stage_since`` maps a reached stage (1-3)
# to when it was reached.
case_type_maturity = Table(
    "case_type_maturity",
    metadata,
    Column("case_type", String(40), primary_key=True),
    Column("stage", Integer, nullable=False),
    Column("agent", String(20), nullable=False),
    Column("signals", JSON, nullable=False),
    Column("stage_since", JSON, nullable=False),
    Column("agent_since", UtcDateTime, nullable=True),
    Column("agent_id", String(120), nullable=True),
    Column("agent_name", String(80), nullable=True),
    Column("changed_at", UtcDateTime, nullable=True),
    Column("changed_by_id", String(ID), nullable=True),
    Column("last_change", String(20), nullable=True),
    _version(),
)

# ADR 0003 (slice 16): a supervisor's conversation with the builder agent. One per person.
# ``messages`` is a JSON list (``[{id, role, text, created_at, client_message_id, answers}]``,
# newest 200), like ``copilot_threads``.
builder_threads = Table(
    "builder_threads",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("staff_id", String(ID), ForeignKey("staff.id"), nullable=False, unique=True),
    Column("agent", String(120), nullable=False),
    Column("agent_session_id", String(120), nullable=True),
    Column("run_id", String(120), nullable=True),
    Column("runs", Integer, nullable=False, default=0),
    Column("messages", JSON, nullable=False),
    Column("last_trace_id", String(120), nullable=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("updated_at", UtcDateTime, nullable=False),
    _version(),
)

# ADR 0003 (slice 16): the platform's index of agent-core's proposals (its registry has no list
# call). ``id`` is agent-core's proposal id. The registry is the source of truth: ``state``, ``rev``
# and ``candidate_hash`` are the last values the platform read from it.
builder_proposals = Table(
    "builder_proposals",
    metadata,
    Column("id", String(120), primary_key=True),
    Column("agent_id", String(120), nullable=False),
    Column("title", String(200), nullable=False),
    Column("origin", String(20), nullable=False),
    Column("created_by", String(120), nullable=False),
    # a staff id, or ``engine`` for a proposal the improvement engine announced (ADR 0007)
    Column("registered_by", String(ID), nullable=False),
    Column("source", String(10), nullable=False),
    Column("state", String(12), nullable=False),
    Column("rev", Integer, nullable=False, default=0),
    Column("base_release_id", String(120), nullable=True),
    Column("candidate_hash", String(120), nullable=True),
    Column("created_at", UtcDateTime, nullable=False),
    Column("updated_at", UtcDateTime, nullable=False),
    Column("refreshed_at", UtcDateTime, nullable=False),
    _version(),
    Index("ix_builder_proposals_agent_updated", "agent_id", "updated_at"),
    Index("ix_builder_proposals_state_updated", "state", "updated_at"),
)

# ADR 0003: which dataset customer (``customers.customer_id`` of the challenge's data) a
# platform customer is. agent-core's customer principal carries that id, never ours. Filled at
# runtime from a private file (``CC_BANK_CUSTOMER_LINKS_FILE``); never committed.
bank_customer_links = Table(
    "bank_customer_links",
    metadata,
    Column("customer_id", String(ID), ForeignKey("customers.id"), primary_key=True),
    Column("bank_customer_id", String(60), nullable=False),
)

# Slice 10: each staff member's notifications (a projection of facts already in the event
# log, never part of it). ``source_key`` (the source event id, or ``sla:<case id>``) is unique
# per recipient: a fact never notifies the same person twice. Only the newest 200 per person
# are kept (``RETENTION_PER_PERSON``).
notifications = Table(
    "notifications",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("recipient_id", String(ID), ForeignKey("staff.id"), nullable=False),
    Column("kind", String(40), nullable=False),
    Column("created_at", UtcDateTime, nullable=False),
    Column("source_key", String(80), nullable=False),
    Column("case_id", String(ID), nullable=True),
    Column("customer_id", String(ID), nullable=True),
    Column("actor_id", String(ID), nullable=True),
    Column("target_id", String(ID), nullable=True),
    Column("escalation_id", String(ID), nullable=True),
    Column("language", String(5), nullable=True),
    Column("score", Integer, nullable=True),
    Column("failed_attempts", Integer, nullable=True),
    Column("read_at", UtcDateTime, nullable=True),
    # ADR 0007 (``improvement_proposed``): the proposal, its agent and the engine's dossier.
    Column("proposal_id", String(64), nullable=True),
    Column("agent_id", String(64), nullable=True),
    Column("improvement", JSON, nullable=True),
    _version(),
    UniqueConstraint("recipient_id", "source_key", name="uq_notifications_recipient_source"),
    # Her list, newest first (keyset pagination and retention).
    Index("ix_notifications_recipient_created", "recipient_id", "created_at", "id"),
    # The bell: her unread count.
    Index("ix_notifications_recipient_read", "recipient_id", "read_at"),
)

customer_case_slots = Table(
    "customer_case_slots",
    metadata,
    Column("customer_id", String(ID), ForeignKey("customers.id"), primary_key=True),
    Column("open_case_id", String(ID), nullable=True),
    _version(),
)

# Append-only history shaped after data-lab/contracts/synthetic-sample/platform_history.json.
# ``sequence`` gives a total ingestion order for cursor pagination and export; rows are
# never updated.
event_log = Table(
    "event_log",
    metadata,
    Column("sequence", Integer, primary_key=True, autoincrement=True),
    Column("event_id", String(ID), nullable=False, unique=True),
    Column("event_type", String(80), nullable=False),
    Column("entity", String(40), nullable=False),
    Column("entity_id", String(ID), nullable=False),
    Column("case_id", String(ID), nullable=True),
    Column("actor_role", String(20), nullable=False),
    Column("actor_id", String(120), nullable=False),
    Column("event_time", UtcDateTime, nullable=False),
    Column("ingested_at", UtcDateTime, nullable=False),
    Column("payload", JSON, nullable=False),
    Index("ix_event_log_case_sequence", "case_id", "sequence"),
    Index("ix_event_log_entity", "entity", "entity_id"),
    Index("ix_event_log_event_time", "event_time"),
    # Audit: "Persona" filter and the supervisor-view dedupe (``latest``).
    Index("ix_event_log_actor_sequence", "actor_id", "sequence"),
    Index("ix_event_log_type_actor_case", "event_type", "actor_id", "case_id"),
)

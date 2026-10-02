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
    Date,
    Float,
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

staff = Table(
    "staff",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("email", String(320), nullable=False, unique=True),
    Column("roles", JSON, nullable=False),
    Column("level", String(20), nullable=False),
    Column("languages", JSON, nullable=False),
    Column("team", String(120), nullable=False),
    Column("active", Boolean, nullable=False, default=True),
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
    _version(),
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

# Masked customer read model (seeded "Datos de ejemplo"; no use case writes it yet).
customers = Table(
    "customers",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("display_name", String(200), nullable=False),
    Column("segment", String(20), nullable=False),
    Column("country", String(2), nullable=False),
    Column("city", String(120), nullable=False),
    Column("locale", String(10), nullable=False),
    Column("customer_since", Date, nullable=False),
    Column("document_type", String(20), nullable=False),
    Column("simulator", Boolean, nullable=False, default=False),
    Column("suggestions", JSON, nullable=False),
)

cases = Table(
    "cases",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("customer_id", String(ID), ForeignKey("customers.id"), nullable=False),
    Column("channel", String(20), nullable=False),
    Column("channel_session", String(20), nullable=False),
    Column("language", String(5), nullable=False),
    Column("origin", String(20), nullable=False),
    Column("topic", String(40), nullable=True),
    Column("priority", String(10), nullable=False),
    Column("status", String(20), nullable=False),
    Column("opened_at", UtcDateTime, nullable=False),
    Column("sla_due_at", UtcDateTime, nullable=False),
    Column("search_text", String(400), nullable=False),
    Column("assigned_analyst_id", String(ID), ForeignKey("staff.id"), nullable=True),
    Column("assigned_at", UtcDateTime, nullable=True),
    Column("queued_at", UtcDateTime, nullable=True),
    Column("queue_label", String(120), nullable=True),
    Column("queue_summary", String(400), nullable=True),
    Column("entry_label", String(120), nullable=True),
    Column("entry_summary", String(400), nullable=True),
    Column("last_sequence", Integer, nullable=False, default=0),
    Column("last_public_sequence", Integer, nullable=False, default=0),
    Column("last_message_at", UtcDateTime, nullable=True),
    Column("last_message_author_role", String(20), nullable=True),
    Column("last_message_preview", String(400), nullable=True),
    Column("last_turn_author_role", String(20), nullable=True),
    Column("last_turn_preview", String(400), nullable=True),
    Column("assignee_read_sequence", Integer, nullable=False, default=0),
    Column("unread_sequences", JSON, nullable=False),
    Column("live_since", UtcDateTime, nullable=True),
    # contract case_close (flattened)
    Column("closed_at", UtcDateTime, nullable=True),
    Column("closed_by_id", String(120), nullable=True),
    Column("closed_by_role", String(20), nullable=True),
    Column("resolved", Boolean, nullable=True),
    Column("contact_reason", String(20), nullable=True),
    Column("resolution_code", String(30), nullable=True),
    Column("followup_at", UtcDateTime, nullable=True),
    Column("csat_requested", Boolean, nullable=True),
    _version(),
    Index("ix_cases_assignee_status", "assigned_analyst_id", "status"),
    Index("ix_cases_status_opened", "status", "opened_at"),
    Index("ix_cases_customer_opened", "customer_id", "opened_at"),
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
    Column("evidence_ids", JSON, nullable=False),
    Column("from_suggestion_id", String(ID), nullable=True),
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
)

customer_case_slots = Table(
    "customer_case_slots",
    metadata,
    Column("customer_id", String(ID), ForeignKey("customers.id"), primary_key=True),
    Column("open_case_id", String(ID), nullable=True),
    _version(),
)

# Contract routing_step (append-only).
routing_steps = Table(
    "routing_steps",
    metadata,
    Column("id", String(ID), primary_key=True),
    Column("case_id", String(ID), ForeignKey("cases.id"), nullable=False, index=True),
    Column("tier", String(20), nullable=False),
    Column("component_id", String(120), nullable=True),
    Column("component_version", String(40), nullable=True),
    Column("component_name", String(120), nullable=True),
    Column("outcome", String(20), nullable=False),
    Column("reason_code", String(80), nullable=True),
    Column("policy_rule_id", String(20), nullable=True),
    Column("confidence", Float, nullable=True),
    Column("inputs_used", JSON, nullable=False),
    Column("handoff", JSON, nullable=True),
    Column("occurred_at", UtcDateTime, nullable=False),
)

# Append-only history shaped after contracts/platform_history.json. ``sequence`` gives a
# total ingestion order for cursor pagination and export; rows are never updated.
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
)

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

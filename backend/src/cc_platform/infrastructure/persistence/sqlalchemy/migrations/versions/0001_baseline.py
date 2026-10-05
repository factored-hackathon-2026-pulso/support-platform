"""Baseline: the schema of slice 22 (the last build that created it with ``create_all``).

A database created by that build (or a later one, before migrations existed) is adopted by
``migrator.migrate``: it is stamped with the revision its columns match, then upgraded.

On Postgres, ``event_log`` is append-only in the database itself: a trigger rejects every
UPDATE, DELETE and TRUNCATE (SQLite keeps the guarantee in code: no repository changes a row).

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# Frozen copies of the types of ``tables.py`` (a migration never imports the live schema).
UTC_DATETIME = sa.DateTime(timezone=True)
JSON_DOCUMENT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
EVENT_SEQUENCE = sa.BigInteger().with_variant(sa.Integer(), "sqlite")

APPEND_ONLY_FUNCTION = """
CREATE FUNCTION event_log_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'event_log is append-only: % is not allowed', TG_OP;
END
$$
"""
APPEND_ONLY_ROWS = """
CREATE TRIGGER event_log_append_only BEFORE UPDATE OR DELETE ON event_log
FOR EACH ROW EXECUTE FUNCTION event_log_reject_change()
"""
APPEND_ONLY_TRUNCATE = """
CREATE TRIGGER event_log_no_truncate BEFORE TRUNCATE ON event_log
FOR EACH STATEMENT EXECUTE FUNCTION event_log_reject_change()
"""


def upgrade() -> None:
    op.create_table(
        "admin_roster",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("admin_ids", JSON_DOCUMENT, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admin_roster")),
    )
    op.create_table(
        "case_type_maturity",
        sa.Column("case_type", sa.String(length=40), nullable=False),
        sa.Column("stage", sa.Integer(), nullable=False),
        sa.Column("agent", sa.String(length=20), nullable=False),
        sa.Column("signals", JSON_DOCUMENT, nullable=False),
        sa.Column("stage_since", JSON_DOCUMENT, nullable=False),
        sa.Column("agent_since", UTC_DATETIME, nullable=True),
        sa.Column("agent_id", sa.String(length=120), nullable=True),
        sa.Column("changed_at", UTC_DATETIME, nullable=True),
        sa.Column("changed_by_id", sa.String(length=40), nullable=True),
        sa.Column("last_change", sa.String(length=20), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("case_type", name=op.f("pk_case_type_maturity")),
    )
    op.create_table(
        "customers",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column("locale", sa.String(length=10), nullable=False),
        sa.Column("simulator", sa.Boolean(), nullable=False),
        sa.Column("suggestions", JSON_DOCUMENT, nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
    )
    op.create_table(
        "dev_mailbox",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("to_address", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("link", sa.String(length=1000), nullable=False),
        sa.Column("sent_at", UTC_DATETIME, nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dev_mailbox")),
    )
    op.create_index("ix_dev_mailbox_sent", "dev_mailbox", ["sent_at", "id"], unique=False)
    op.create_table(
        "event_log",
        sa.Column("sequence", EVENT_SEQUENCE, autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(length=40), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("entity", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=True),
        sa.Column("actor_role", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.String(length=120), nullable=False),
        sa.Column("event_time", UTC_DATETIME, nullable=False),
        sa.Column("ingested_at", UTC_DATETIME, nullable=False),
        sa.Column("payload", JSON_DOCUMENT, nullable=False),
        sa.PrimaryKeyConstraint("sequence", name=op.f("pk_event_log")),
        sa.UniqueConstraint("event_id", name=op.f("uq_event_log_event_id")),
    )
    op.create_index(
        "ix_event_log_actor_sequence", "event_log", ["actor_id", "sequence"], unique=False
    )
    op.create_index(
        "ix_event_log_case_sequence", "event_log", ["case_id", "sequence"], unique=False
    )
    op.create_index("ix_event_log_entity", "event_log", ["entity", "entity_id"], unique=False)
    op.create_index("ix_event_log_event_time", "event_log", ["event_time"], unique=False)
    op.create_index(
        "ix_event_log_type_actor_case",
        "event_log",
        ["event_type", "actor_id", "case_id"],
        unique=False,
    )
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("ai_enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=True),
        sa.Column("updated_by_id", sa.String(length=40), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_settings")),
    )
    op.create_table(
        "teams",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("name_key", sa.String(length=80), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("creation_key", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("creation_key", name=op.f("uq_teams_creation_key")),
        sa.UniqueConstraint("name_key", name=op.f("uq_teams_name_key")),
    )
    op.create_table(
        "bank_customer_links",
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("bank_customer_id", sa.String(length=60), nullable=False),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_bank_customer_links_customer_id_customers"),
        ),
        sa.PrimaryKeyConstraint("customer_id", name=op.f("pk_bank_customer_links")),
    )
    op.create_table(
        "customer_case_slots",
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("open_case_id", sa.String(length=40), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_customer_case_slots_customer_id_customers"),
        ),
        sa.PrimaryKeyConstraint("customer_id", name=op.f("pk_customer_case_slots")),
    )
    op.create_table(
        "staff",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("roles", JSON_DOCUMENT, nullable=False),
        sa.Column("languages", JSON_DOCUMENT, nullable=False),
        sa.Column("team_id", sa.String(length=40), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("creation_key", sa.String(length=64), nullable=True),
        sa.Column("setup", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], name=op.f("fk_staff_team_id_teams")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff")),
        sa.UniqueConstraint("creation_key", name=op.f("uq_staff_creation_key")),
        sa.UniqueConstraint("email", name=op.f("uq_staff_email")),
    )
    op.create_index(op.f("ix_staff_team_id"), "staff", ["team_id"], unique=False)
    op.create_table(
        "analyst_availability",
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("since", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_analyst_availability_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("staff_id", name=op.f("pk_analyst_availability")),
    )
    op.create_table(
        "builder_proposals",
        sa.Column("id", sa.String(length=120), nullable=False),
        sa.Column("agent_id", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("registered_by", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("rev", sa.Integer(), nullable=False),
        sa.Column("base_release_id", sa.String(length=120), nullable=True),
        sa.Column("candidate_hash", sa.String(length=120), nullable=True),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=False),
        sa.Column("refreshed_at", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["registered_by"], ["staff.id"], name=op.f("fk_builder_proposals_registered_by_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_builder_proposals")),
    )
    op.create_index(
        "ix_builder_proposals_agent_updated",
        "builder_proposals",
        ["agent_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_builder_proposals_state_updated",
        "builder_proposals",
        ["state", "updated_at"],
        unique=False,
    )
    op.create_table(
        "builder_threads",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("agent", sa.String(length=120), nullable=False),
        sa.Column("agent_session_id", sa.String(length=120), nullable=True),
        sa.Column("run_id", sa.String(length=120), nullable=True),
        sa.Column("runs", sa.Integer(), nullable=False),
        sa.Column("messages", JSON_DOCUMENT, nullable=False),
        sa.Column("last_trace_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_builder_threads_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_builder_threads")),
        sa.UniqueConstraint("staff_id", name=op.f("uq_builder_threads_staff_id")),
    )
    op.create_table(
        "cases",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("language", sa.String(length=5), nullable=False),
        sa.Column("priority", sa.String(length=10), nullable=False),
        sa.Column("case_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("opened_at", UTC_DATETIME, nullable=False),
        sa.Column("sla_due_at", UTC_DATETIME, nullable=False),
        sa.Column("first_response_at", UTC_DATETIME, nullable=True),
        sa.Column("search_text", sa.String(length=400), nullable=False),
        sa.Column("previous_case_id", sa.String(length=40), nullable=True),
        sa.Column("assigned_analyst_id", sa.String(length=40), nullable=True),
        sa.Column("assigned_at", UTC_DATETIME, nullable=True),
        sa.Column("queued_at", UTC_DATETIME, nullable=True),
        sa.Column("queue_label", sa.String(length=120), nullable=True),
        sa.Column("last_sequence", sa.Integer(), nullable=False),
        sa.Column("last_public_sequence", sa.Integer(), nullable=False),
        sa.Column("last_message_at", UTC_DATETIME, nullable=True),
        sa.Column("last_message_author_role", sa.String(length=20), nullable=True),
        sa.Column("last_message_preview", sa.String(length=400), nullable=True),
        sa.Column("last_turn_author_role", sa.String(length=20), nullable=True),
        sa.Column("last_turn_preview", sa.String(length=400), nullable=True),
        sa.Column("assignee_read_sequence", sa.Integer(), nullable=False),
        sa.Column("unread_sequences", JSON_DOCUMENT, nullable=False),
        sa.Column("closed_at", UTC_DATETIME, nullable=True),
        sa.Column("closed_by_id", sa.String(length=120), nullable=True),
        sa.Column("closed_by_role", sa.String(length=20), nullable=True),
        sa.Column("close_reason", sa.String(length=30), nullable=True),
        sa.Column("close_note", sa.String(length=500), nullable=True),
        sa.Column("rating_score", sa.Integer(), nullable=True),
        sa.Column("rating_comment", sa.String(length=500), nullable=True),
        sa.Column("rated_at", UTC_DATETIME, nullable=True),
        sa.Column("rating_key", sa.String(length=64), nullable=True),
        sa.Column("open_escalation_id", sa.String(length=40), nullable=True),
        sa.Column("active_call_id", sa.String(length=40), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["assigned_analyst_id"], ["staff.id"], name=op.f("fk_cases_assigned_analyst_id_staff")
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"], ["customers.id"], name=op.f("fk_cases_customer_id_customers")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cases")),
    )
    op.create_index(
        "ix_cases_assignee_closed", "cases", ["assigned_analyst_id", "closed_at"], unique=False
    )
    op.create_index(
        "ix_cases_assignee_status", "cases", ["assigned_analyst_id", "status"], unique=False
    )
    op.create_index("ix_cases_closer_closed", "cases", ["closed_by_id", "closed_at"], unique=False)
    op.create_index("ix_cases_customer_opened", "cases", ["customer_id", "opened_at"], unique=False)
    op.create_index("ix_cases_language_status", "cases", ["language", "status"], unique=False)
    op.create_index("ix_cases_status_opened", "cases", ["status", "opened_at"], unique=False)
    op.create_table(
        "invitations",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("sent_at", UTC_DATETIME, nullable=False),
        sa.Column("expires_at", UTC_DATETIME, nullable=False),
        sa.Column("created_by", sa.String(length=40), nullable=False),
        sa.Column("resend_count", sa.Integer(), nullable=False),
        sa.Column("accepted_at", UTC_DATETIME, nullable=True),
        sa.Column("cancelled_at", UTC_DATETIME, nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("totp_secret", sa.String(length=512), nullable=True),
        sa.Column("failed_codes", sa.Integer(), nullable=False),
        sa.Column("locked_until", UTC_DATETIME, nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_invitations_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invitations")),
        sa.UniqueConstraint("staff_id", name=op.f("uq_invitations_staff_id")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_invitations_token_hash")),
    )
    op.create_table(
        "login_accounts",
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_until", UTC_DATETIME, nullable=True),
        sa.Column("last_login_at", UTC_DATETIME, nullable=True),
        sa.Column("totp_secret", sa.String(length=512), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_login_accounts_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("staff_id", name=op.f("pk_login_accounts")),
    )
    op.create_table(
        "mfa_challenges",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("issued_at", UTC_DATETIME, nullable=False),
        sa.Column("expires_at", UTC_DATETIME, nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("verified_at", UTC_DATETIME, nullable=True),
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_mfa_challenges_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mfa_challenges")),
    )
    op.create_index(
        op.f("ix_mfa_challenges_staff_id"), "mfa_challenges", ["staff_id"], unique=False
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("recipient_id", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("source_key", sa.String(length=80), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=True),
        sa.Column("customer_id", sa.String(length=40), nullable=True),
        sa.Column("actor_id", sa.String(length=40), nullable=True),
        sa.Column("target_id", sa.String(length=40), nullable=True),
        sa.Column("escalation_id", sa.String(length=40), nullable=True),
        sa.Column("language", sa.String(length=5), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=True),
        sa.Column("read_at", UTC_DATETIME, nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["recipient_id"], ["staff.id"], name=op.f("fk_notifications_recipient_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("recipient_id", "source_key", name="uq_notifications_recipient_source"),
    )
    op.create_index(
        "ix_notifications_recipient_created",
        "notifications",
        ["recipient_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_recipient_read",
        "notifications",
        ["recipient_id", "read_at"],
        unique=False,
    )
    op.create_table(
        "password_resets",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("sent_at", UTC_DATETIME, nullable=False),
        sa.Column("expires_at", UTC_DATETIME, nullable=False),
        sa.Column("created_by", sa.String(length=40), nullable=False),
        sa.Column("used_at", UTC_DATETIME, nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_password_resets_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_resets")),
        sa.UniqueConstraint("staff_id", name=op.f("uq_password_resets_staff_id")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_password_resets_token_hash")),
    )
    op.create_table(
        "staff_preferences",
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("ui_language", sa.String(length=10), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_staff_preferences_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("staff_id", name=op.f("pk_staff_preferences")),
    )
    op.create_table(
        "staff_sessions",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("issued_at", UTC_DATETIME, nullable=False),
        sa.Column("expires_at", UTC_DATETIME, nullable=False),
        sa.Column("mfa_method", sa.String(length=20), nullable=False),
        sa.Column("ended_at", UTC_DATETIME, nullable=True),
        sa.Column("end_reason", sa.String(length=20), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_staff_sessions_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff_sessions")),
    )
    op.create_index(
        op.f("ix_staff_sessions_staff_id"), "staff_sessions", ["staff_id"], unique=False
    )
    op.create_table(
        "assignments",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("staff_id", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("policy_rule_id", sa.String(length=20), nullable=True),
        sa.Column("open_cases_at_assignment", sa.Integer(), nullable=False),
        sa.Column("strategy", sa.String(length=80), nullable=False),
        sa.Column("assigned_at", UTC_DATETIME, nullable=False),
        sa.Column("assigned_by_role", sa.String(length=20), nullable=False),
        sa.Column("assigned_by_id", sa.String(length=120), nullable=False),
        sa.Column("waited_seconds", sa.Integer(), nullable=True),
        sa.Column("previous_staff_id", sa.String(length=40), nullable=True),
        sa.Column("paused_override", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_assignments_case_id_cases")
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_assignments_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assignments")),
    )
    op.create_index(op.f("ix_assignments_case_id"), "assignments", ["case_id"], unique=False)
    op.create_index(
        "ix_assignments_previous_staff_assigned",
        "assignments",
        ["previous_staff_id", "assigned_at"],
        unique=False,
    )
    op.create_index(
        "ix_assignments_staff_assigned", "assignments", ["staff_id", "assigned_at"], unique=False
    )
    op.create_index(
        "ix_assignments_staff_case", "assignments", ["staff_id", "case_id"], unique=False
    )
    op.create_table(
        "assistant_sessions",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("entry_agent", sa.String(length=120), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("agent", sa.String(length=120), nullable=True),
        sa.Column("agent_session_id", sa.String(length=120), nullable=True),
        sa.Column("run_id", sa.String(length=120), nullable=True),
        sa.Column("awaiting", sa.String(length=20), nullable=False),
        sa.Column("confirmation", JSON_DOCUMENT, nullable=True),
        sa.Column("step_up", JSON_DOCUMENT, nullable=True),
        sa.Column("step_up_verified_at", UTC_DATETIME, nullable=True),
        sa.Column("step_up_attempts", sa.Integer(), nullable=False),
        sa.Column("processed_sequence", sa.Integer(), nullable=False),
        sa.Column("claim", JSON_DOCUMENT, nullable=True),
        sa.Column("claimed_at", UTC_DATETIME, nullable=True),
        sa.Column("queued", JSON_DOCUMENT, nullable=True),
        sa.Column("blocked", JSON_DOCUMENT, nullable=True),
        sa.Column("resend_blocked", sa.Boolean(), nullable=False),
        sa.Column("handoff_ref", sa.String(length=120), nullable=True),
        sa.Column("handoff_resolved_at", UTC_DATETIME, nullable=True),
        sa.Column("failure_code", sa.String(length=60), nullable=True),
        sa.Column("last_trace_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_assistant_sessions_case_id_cases")
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_assistant_sessions_customer_id_customers"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_sessions")),
        sa.UniqueConstraint("case_id", name=op.f("uq_assistant_sessions_case_id")),
    )
    op.create_index(
        "ix_assistant_sessions_state_updated",
        "assistant_sessions",
        ["state", "updated_at"],
        unique=False,
    )
    op.create_table(
        "calls",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("state", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("analyst_id", sa.String(length=40), nullable=True),
        sa.Column("started_at", UTC_DATETIME, nullable=False),
        sa.Column("answered_at", UTC_DATETIME, nullable=True),
        sa.Column("ended_at", UTC_DATETIME, nullable=True),
        sa.Column("end_reason", sa.String(length=20), nullable=True),
        sa.Column("ended_by_role", sa.String(length=20), nullable=True),
        sa.Column("muted", sa.Boolean(), nullable=False),
        sa.Column("holds", JSON_DOCUMENT, nullable=False),
        sa.Column("creation_key", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name=op.f("fk_calls_case_id_cases")),
        sa.ForeignKeyConstraint(
            ["customer_id"], ["customers.id"], name=op.f("fk_calls_customer_id_customers")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calls")),
        sa.UniqueConstraint("creation_key", name=op.f("uq_calls_creation_key")),
    )
    op.create_index("ix_calls_case_started", "calls", ["case_id", "started_at"], unique=False)
    op.create_table(
        "copilot_suggestions",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("analyst_id", sa.String(length=40), nullable=False),
        sa.Column("agent", sa.String(length=120), nullable=False),
        sa.Column("trigger", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("based_on_sequence", sa.Integer(), nullable=False),
        sa.Column("request_key", sa.String(length=80), nullable=True),
        sa.Column("items", JSON_DOCUMENT, nullable=False),
        sa.Column("kinds", JSON_DOCUMENT, nullable=False),
        sa.Column("tool_ids", JSON_DOCUMENT, nullable=False),
        sa.Column("reply_hash", sa.String(length=64), nullable=True),
        sa.Column("reply_decision", sa.String(length=20), nullable=True),
        sa.Column("edit_distance_permille", sa.Integer(), nullable=True),
        sa.Column("escalation_accepted", sa.Boolean(), nullable=False),
        sa.Column("run_id", sa.String(length=120), nullable=True),
        sa.Column("trace_id", sa.String(length=120), nullable=True),
        sa.Column("failure_code", sa.String(length=60), nullable=True),
        sa.Column("purged_at", UTC_DATETIME, nullable=True),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["analyst_id"], ["staff.id"], name=op.f("fk_copilot_suggestions_analyst_id_staff")
        ),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_copilot_suggestions_case_id_cases")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_copilot_suggestions")),
        sa.UniqueConstraint(
            "case_id", "analyst_id", "request_key", name="uq_copilot_suggestions_case_analyst_key"
        ),
    )
    op.create_index(
        "ix_copilot_suggestions_case_analyst_created",
        "copilot_suggestions",
        ["case_id", "analyst_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_copilot_suggestions_status_created",
        "copilot_suggestions",
        ["status", "created_at"],
        unique=False,
    )
    op.create_table(
        "copilot_threads",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("analyst_id", sa.String(length=40), nullable=False),
        sa.Column("agent", sa.String(length=120), nullable=False),
        sa.Column("agent_session_id", sa.String(length=120), nullable=True),
        sa.Column("run_id", sa.String(length=120), nullable=True),
        sa.Column("runs", sa.Integer(), nullable=False),
        sa.Column("messages", JSON_DOCUMENT, nullable=False),
        sa.Column("last_trace_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("updated_at", UTC_DATETIME, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["analyst_id"], ["staff.id"], name=op.f("fk_copilot_threads_analyst_id_staff")
        ),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_copilot_threads_case_id_cases")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_copilot_threads")),
        sa.UniqueConstraint("case_id", "analyst_id", name="uq_copilot_threads_case_analyst"),
    )
    op.create_table(
        "escalations",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("motive", sa.String(length=500), nullable=False),
        sa.Column("escalated_by_id", sa.String(length=40), nullable=False),
        sa.Column("escalated_at", UTC_DATETIME, nullable=False),
        sa.Column("resolved_at", UTC_DATETIME, nullable=True),
        sa.Column("resolved_by_id", sa.String(length=40), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("reassigned_to_id", sa.String(length=40), nullable=True),
        sa.Column("acknowledged_at", UTC_DATETIME, nullable=True),
        sa.Column("creation_key", sa.String(length=64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_escalations_case_id_cases")
        ),
        sa.ForeignKeyConstraint(
            ["escalated_by_id"], ["staff.id"], name=op.f("fk_escalations_escalated_by_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_escalations")),
        sa.UniqueConstraint("creation_key", name=op.f("uq_escalations_creation_key")),
    )
    op.create_index(
        "ix_escalations_case_escalated", "escalations", ["case_id", "escalated_at"], unique=False
    )
    op.create_index("ix_escalations_resolved", "escalations", ["resolved_at"], unique=False)
    op.create_index(
        "ix_escalations_state_escalated", "escalations", ["state", "escalated_at"], unique=False
    )
    op.create_table(
        "turns",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=40), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("audience", sa.String(length=20), nullable=False),
        sa.Column("author_role", sa.String(length=20), nullable=False),
        sa.Column("author_id", sa.String(length=120), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=5), nullable=False),
        sa.Column("created_at", UTC_DATETIME, nullable=False),
        sa.Column("client_message_id", sa.String(length=64), nullable=True),
        sa.Column("subject", sa.String(length=200), nullable=True),
        sa.Column("staff_line", JSON_DOCUMENT, nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name=op.f("fk_turns_case_id_cases")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_turns")),
        sa.UniqueConstraint(
            "author_id", "client_message_id", name="uq_turns_author_client_message"
        ),
        sa.UniqueConstraint("case_id", "sequence", name="uq_turns_case_sequence"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(APPEND_ONLY_FUNCTION)
        op.execute(APPEND_ONLY_ROWS)
        op.execute(APPEND_ONLY_TRUNCATE)


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

"""The improvement engine announces proposals (PR 17, ADR 0007).

``builder_proposals.registered_by`` may now be ``engine`` (no staff row), so its foreign key
goes; Supervisión's ``improvement_proposed`` notification carries the proposal, its agent and
the engine's dossier.

Revision ID: 0003_engine_announce
Revises: 0002_suggestion_truncated
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_engine_announce"
down_revision = "0002_suggestion_truncated"
branch_labels = None
depends_on = None

JSON_DOCUMENT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("builder_proposals") as batch:
        batch.drop_constraint("fk_builder_proposals_registered_by_staff", type_="foreignkey")
    with op.batch_alter_table("notifications") as batch:
        batch.add_column(sa.Column("proposal_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("agent_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("improvement", JSON_DOCUMENT, nullable=True))


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

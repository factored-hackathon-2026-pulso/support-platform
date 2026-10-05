"""Copilot suggestions flag a truncated answer (PR 25: at most 3 suggestions).

Revision ID: 0002_suggestion_truncated
Revises: 0001_baseline
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_suggestion_truncated"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("copilot_suggestions") as batch:
        batch.add_column(
            sa.Column("truncated", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

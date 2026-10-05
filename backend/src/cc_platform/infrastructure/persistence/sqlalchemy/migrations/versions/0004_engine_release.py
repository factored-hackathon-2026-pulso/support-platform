"""The agent release on the AI events (PR 27, engine signals).

Revision ID: 0004_engine_release
Revises: 0003_engine_announce
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_engine_release"
down_revision = "0003_engine_announce"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("assistant_sessions") as batch:
        batch.add_column(sa.Column("agent_release", sa.String(length=120), nullable=True))
    with op.batch_alter_table("copilot_suggestions") as batch:
        batch.add_column(sa.Column("release", sa.String(length=120), nullable=True))


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

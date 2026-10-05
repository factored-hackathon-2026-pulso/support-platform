"""The agent catalog on the case-type maturity: a display name and the paused flag (PR 31).

Revision ID: 0005_agent_catalog
Revises: 0004_engine_release
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_agent_catalog"
down_revision = "0004_engine_release"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("case_type_maturity") as batch:
        batch.add_column(sa.Column("agent_name", sa.String(length=80), nullable=True))
        batch.add_column(
            sa.Column("agent_paused", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

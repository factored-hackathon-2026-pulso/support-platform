"""The photo (avatar) Supervisión picks for the agent of a case type.

Revision ID: 0006_agent_avatar
Revises: 0005_agent_catalog
Create Date: 2026-10-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_agent_avatar"
down_revision = "0005_agent_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("case_type_maturity") as batch:
        batch.add_column(sa.Column("agent_avatar", sa.String(length=20), nullable=True))


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

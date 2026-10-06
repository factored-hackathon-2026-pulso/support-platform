"""What Supervisión sets for an agent by its id (its photo), so it can be picked before the agent
serves a case type.

Revision ID: 0007_agent_profiles
Revises: 0006_agent_avatar
Create Date: 2026-10-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_agent_profiles"
down_revision = "0006_agent_avatar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_profiles",
        sa.Column("agent_id", sa.String(length=120), primary_key=True),
        sa.Column("avatar", sa.String(length=20), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    # The photos already picked on a type that runs an agent.
    op.execute(
        "INSERT INTO agent_profiles (agent_id, avatar, version) "
        "SELECT agent_id, agent_avatar, 1 FROM case_type_maturity "
        "WHERE agent_id IS NOT NULL AND agent_avatar IS NOT NULL"
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (docs/platform/deploy/database.md).")

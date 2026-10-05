"""SQL repository of the platform context (slice 18)."""

from __future__ import annotations

from typing import Any

from cc_platform.domain.platform.settings import SETTINGS_ID, PlatformSettings
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


class SqlPlatformSettingsRepository(VersionedRepository[PlatformSettings]):
    """The singleton of platform-wide settings, created on the first change."""

    table = tables.platform_settings
    insert_race_is_retryable = True

    def _key(self, aggregate: PlatformSettings) -> str:
        return aggregate.id

    def _to_row(self, aggregate: PlatformSettings) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "ai_enabled": aggregate.ai_enabled,
            "updated_at": aggregate.updated_at,
            "updated_by_id": aggregate.updated_by_id,
        }

    def _from_row(self, row: Row) -> PlatformSettings:
        return PlatformSettings(
            id=row["id"],
            ai_enabled=row["ai_enabled"],
            updated_at=row["updated_at"],
            updated_by_id=row["updated_by_id"],
        )

    async def get(self, key: str = SETTINGS_ID) -> PlatformSettings | None:
        return await super().get(key)

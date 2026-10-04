"""Health and metadata schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel


class HealthResponse(ApiModel):
    status: Literal["ok", "degraded"]
    checks: dict[str, Literal["ok", "failing"]]


class MetaResponse(ApiModel):
    name: str
    version: str
    build: str
    environment: str
    api_version: str
    dev_mailbox: bool = Field(
        description="Part 4: the development mailbox is on (never in production)."
    )

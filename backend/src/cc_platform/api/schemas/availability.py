"""Analyst availability schemas ("Disponible" / "En pausa")."""

from __future__ import annotations

from datetime import datetime

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.people.availability import AvailabilityView
from cc_platform.domain.people.availability import AvailabilityStatus


class Availability(ApiModel):
    status: AvailabilityStatus
    since: datetime

    @classmethod
    def from_view(cls, view: AvailabilityView) -> Availability:
        return cls(status=view.status, since=view.since)


class UpdateAvailabilityRequest(RequestModel):
    status: AvailabilityStatus

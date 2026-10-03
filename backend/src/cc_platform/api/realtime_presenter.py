"""``CaseRealtimePresenter`` / ``SupervisionRealtimePresenter`` adapter: socket payloads
rendered by the REST schemas.

The realtime projection (application layer) builds views; this module turns them into the
exact camelCase JSON the REST endpoints return, so the frontend parses one shape.
"""

from __future__ import annotations

from typing import cast

from cc_platform.api.schemas.availability import Availability
from cc_platform.api.schemas.cases import CaseSummary, InboxCounts, Turn
from cc_platform.api.schemas.common import ApiModel
from cc_platform.api.schemas.customer import CustomerConversation, CustomerTurn
from cc_platform.api.schemas.supervision import QueueCounts
from cc_platform.application.cases.dto import (
    CaseSummaryView,
    CustomerConversationView,
    CustomerTurnView,
    InboxCountsView,
    TurnView,
)
from cc_platform.application.cases.supervision import QueueCountsView
from cc_platform.application.people.availability import AvailabilityView
from cc_platform.domain.shared.json import JsonObject


def _json(model: ApiModel) -> JsonObject:
    return cast("JsonObject", model.model_dump(mode="json", by_alias=True))


class SchemaRealtimePresenter:
    def case_summary(self, view: CaseSummaryView) -> JsonObject:
        return _json(CaseSummary.from_view(view))

    def turn(self, view: TurnView) -> JsonObject:
        return _json(Turn.from_view(view))

    def customer_turn(self, view: CustomerTurnView) -> JsonObject:
        return _json(CustomerTurn.from_view(view))

    def conversation(self, view: CustomerConversationView) -> JsonObject:
        return _json(CustomerConversation.from_view(view))

    def inbox_counts(self, view: InboxCountsView) -> JsonObject:
        return _json(InboxCounts.from_view(view))

    def availability(self, view: AvailabilityView) -> JsonObject:
        return _json(Availability.from_view(view))

    def queue_counts(self, view: QueueCountsView) -> JsonObject:
        return _json(QueueCounts.from_view(view))

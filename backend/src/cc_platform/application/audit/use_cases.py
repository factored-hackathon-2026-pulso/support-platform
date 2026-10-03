"""The use cases of the audit context, as one bundle the composition root builds."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.audit.queries import GetAuditEvent, ListAuditEvents


@dataclass(frozen=True, slots=True)
class AuditUseCases:
    list_events: ListAuditEvents
    get_event: GetAuditEvent

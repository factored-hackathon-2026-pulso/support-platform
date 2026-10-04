"""``ListDevMailbox``: what the development mailbox "sent" (``GET /api/v1/dev/mailbox``).

Only while ``CC_DEV_MAILBOX`` is on (never in production): otherwise there is no mailbox and
the route answers 404, as if it did not exist.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.onboarding.dto import DevMailboxView
from cc_platform.application.ports.email import DevMailbox
from cc_platform.domain.shared.errors import NotFoundError

#: Team-generated: the page shows at most this many messages.
MAX_LISTED = 50


@dataclass(frozen=True, slots=True)
class ListDevMailbox:
    mailbox: DevMailbox | None

    @property
    def enabled(self) -> bool:
        return self.mailbox is not None

    async def execute(self, limit: int = MAX_LISTED) -> DevMailboxView:
        if self.mailbox is None:
            raise NotFoundError()
        messages = await self.mailbox.latest(max(1, min(limit, MAX_LISTED)))
        return DevMailboxView(items=tuple(messages))

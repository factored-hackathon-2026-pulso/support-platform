"""The development mailbox (``EmailSender`` + ``DevMailbox`` ports, part 4).

No external service: "sending" stores the message, and ``GET /api/v1/dev/mailbox`` lists
the newest ones so a demo (or the browser e2e) can open the invitation and reset links. Only
built when ``CC_DEV_MAILBOX`` is on, which the settings refuse in production. Two stores:

- ``SqlDevMailbox``: the ``dev_mailbox`` table of the platform database (survives a
  restart, like the invitation it announces);
- ``InMemoryDevMailbox``: process memory (``CC_PERSISTENCE=memory`` and unit tests).

Both keep at most ``MAX_KEPT`` messages (the oldest are dropped).

``DiscardingEmailSender`` is the sender when the mailbox is off outside production: it
drops the message and logs only its kind (never the address, the subject or the link).
"""

from __future__ import annotations

from collections import deque

import structlog
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.email import EmailKind, EmailMessage, SentEmail
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.domain.shared.ids import IdPrefix
from cc_platform.infrastructure.persistence.sqlalchemy import tables

_log = structlog.get_logger(__name__)

#: Team-generated: the dev mailbox keeps the newest 200 messages.
MAX_KEPT = 200


class InMemoryDevMailbox:
    def __init__(self, *, clock: Clock, ids: IdGenerator) -> None:
        self._clock = clock
        self._ids = ids
        self._messages: deque[SentEmail] = deque(maxlen=MAX_KEPT)

    async def send(self, message: EmailMessage) -> None:
        self._messages.append(_stored(message, self._ids, self._clock))
        _log.info("dev_mailbox_delivered", kind=message.kind.value)

    async def latest(self, limit: int) -> list[SentEmail]:
        return list(reversed(self._messages))[:limit]


class SqlDevMailbox:
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession], *, clock: Clock, ids: IdGenerator
    ) -> None:
        self._sessions = session_factory
        self._clock = clock
        self._ids = ids

    async def send(self, message: EmailMessage) -> None:
        sent = _stored(message, self._ids, self._clock)
        table = tables.dev_mailbox
        async with self._sessions() as session:
            await session.execute(
                insert(table).values(
                    id=sent.id,
                    kind=sent.kind.value,
                    to_address=sent.to,
                    subject=sent.subject,
                    text=sent.text,
                    link=sent.link,
                    sent_at=sent.sent_at,
                )
            )
            kept = (
                select(table.c.id)
                .order_by(table.c.sent_at.desc(), table.c.id.desc())
                .limit(MAX_KEPT)
                .scalar_subquery()
            )
            await session.execute(delete(table).where(table.c.id.not_in(kept)))
            await session.commit()
        _log.info("dev_mailbox_delivered", kind=message.kind.value)

    async def latest(self, limit: int) -> list[SentEmail]:
        table = tables.dev_mailbox
        async with self._sessions() as session:
            result = await session.execute(
                select(table).order_by(table.c.sent_at.desc(), table.c.id.desc()).limit(limit)
            )
            return [
                SentEmail(
                    id=row["id"],
                    kind=EmailKind(row["kind"]),
                    to=row["to_address"],
                    subject=row["subject"],
                    text=row["text"],
                    link=row["link"],
                    sent_at=row["sent_at"],
                )
                for row in result.mappings()
            ]


class DiscardingEmailSender:
    async def send(self, message: EmailMessage) -> None:
        _log.warning("email_not_delivered", kind=message.kind.value, reason="no_email_adapter")


def _stored(message: EmailMessage, ids: IdGenerator, clock: Clock) -> SentEmail:
    return SentEmail(
        id=ids.new_id(IdPrefix.EMAIL),
        kind=message.kind,
        to=message.to,
        subject=message.subject,
        text=message.text,
        link=message.link,
        sent_at=clock.now(),
    )

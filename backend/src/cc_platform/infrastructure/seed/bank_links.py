"""Seed bank links: SYNTHETIC demo customers the assistant can talk to out of the box (ADR 0003).

A platform customer reaches the assistant only when it is linked to a dataset customer
(``bank_customer_links``, normally loaded from ``CC_BANK_CUSTOMER_LINKS_FILE``). The seed had
none, so every simulator chat went to people. These links point three simulator customers at
**invented** ids (``SYNTHETIC-DEMO-BANK-*``): they name no real dataset customer, so the
assistant's data tools find nothing for them, and the chat still reaches the assistant. Natalia
(2001, es-CO), Ximena (2002, es-MX) and Rafael (2004, pt-BR) are linked; Santiago (2003) and the
fifth simulator customer stay unlinked on purpose, to show the people-only path.

The real file (``CC_BANK_CUSTOMER_LINKS_FILE``) is applied after the seed and wins. Switch the
seed links off with ``CC_SEED_DEMO_BANK_LINKS=false``.
"""

from __future__ import annotations

from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.infrastructure.seed.customers import seed_customer_id

#: simulator customer number -> an invented dataset id (never a real customer).
SYNTHETIC_BANK_LINKS: dict[int, str] = {
    2001: "SYNTHETIC-DEMO-BANK-2001",
    2002: "SYNTHETIC-DEMO-BANK-2002",
    2004: "SYNTHETIC-DEMO-BANK-2004",
}


async def seed_demo_bank_links(uow: UnitOfWorkFactory) -> int:
    """Link the synthetic demo customers that have no link yet. Idempotent; returns how many."""
    wanted = {seed_customer_id(n): bank for n, bank in SYNTHETIC_BANK_LINKS.items()}
    async with uow() as unit:
        known = await unit.customers.get_many(set(wanted))
        missing: dict[str, str] = {}
        for customer_id, bank in wanted.items():
            if customer_id in known and await unit.bank_links.get(customer_id) is None:
                missing[customer_id] = bank
        changed = await unit.bank_links.set_many(missing) if missing else 0
        await unit.commit()
    return changed

"""Evidence for the improvement engine (ADR 0007): which real cases sit in a cell.

The engine's findings are about cells (case type x channel x language ...); a supervisor who
reads a proposal needs real cases to open. ``SampleEvidenceCases`` answers with a bounded sample
of case ids for one cell, and only when the cell is large enough to be an aggregate: a cell with
fewer than ``min_cell`` cases answers ``suppressed`` with no ids and no count (k-anonymity), so
the route cannot be used to look up one customer's case. Ids only: never a text, a customer or
an analyst. Read-only.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.ports import EvidenceCell
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory

#: The announcement accepts at most 8 evidence links (``MAX_EVIDENCE_LINKS``).
MAX_SAMPLE = 8


@dataclass(frozen=True, slots=True)
class EvidenceSampleView:
    suppressed: bool
    matched: int | None
    """The cell's size; ``None`` when suppressed (a small count identifies people)."""
    case_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SampleEvidenceCases:
    uow: UnitOfWorkFactory
    min_cell: int = 10

    async def execute(self, cell: EvidenceCell, *, limit: int = MAX_SAMPLE) -> EvidenceSampleView:
        wanted = max(1, min(limit, MAX_SAMPLE))
        async with self.uow() as uow:
            sample = await uow.cases.sample_cell(cell, limit=wanted)
        if sample.matched < self.min_cell:
            return EvidenceSampleView(suppressed=True, matched=None, case_ids=())
        return EvidenceSampleView(
            suppressed=False, matched=sample.matched, case_ids=sample.case_ids
        )

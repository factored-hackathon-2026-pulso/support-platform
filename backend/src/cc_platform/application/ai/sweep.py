"""``SweepAssistantSessions``: recover assistant work lost with its process (ADR 0003, S17).

The assistant answers in a background job (``AssistantTurnProcess``). If the process dies between
a customer's message and the answer, nothing re-triggers it: the job lived in memory. This sweep
runs every few seconds and, for each **active** session that has been quiet for a moment, spawns
``AssistantEngine.run_case`` again. The job is idempotent (it claims an input with a
compare-and-set, takes over a stale claim, and does nothing when there is nothing to send),
so sessions that only wait for the customer cost one short read, and a live job is never run
twice at once.

Failures are logged by the background runner (``BackgroundTasks`` logs every failed job).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from functools import partial

from cc_platform.application.ai.engine import AssistantEngine
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory

#: A session touched more recently than this is left to the job that is (probably) running it.
MIN_QUIET = timedelta(seconds=20)


@dataclass(frozen=True, slots=True)
class SweepAssistantSessions:
    uow: UnitOfWorkFactory
    clock: Clock
    tasks: BackgroundTasks
    engine: AssistantEngine
    min_quiet: timedelta = MIN_QUIET

    async def execute(self) -> int:
        """Spawn a job for every quiet active session; returns how many."""
        cutoff = self.clock.now() - self.min_quiet
        async with self.uow() as uow:
            sessions = await uow.assistant_sessions.list_active()
        quiet = [s.case_id for s in sessions if s.updated_at <= cutoff]
        for case_id in quiet:
            self.tasks.spawn(f"assistant_sweep:{case_id}", partial(self.engine.run_case, case_id))
        return len(quiet)

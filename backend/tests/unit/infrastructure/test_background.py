"""In-process background tasks: run detached, isolate failures, drain nested jobs."""

from __future__ import annotations

import asyncio

import pytest

from cc_platform.infrastructure.background import AsyncioBackgroundTasks, PeriodicTask


async def test_runs_jobs_isolates_failures_and_drains_nested_work() -> None:
    tasks = AsyncioBackgroundTasks()
    done: list[str] = []

    async def nested() -> None:
        done.append("nested")

    async def outer() -> None:
        done.append("outer")
        tasks.spawn("nested", nested)

    async def broken() -> None:
        raise RuntimeError("boom")

    tasks.spawn("broken", broken)
    tasks.spawn("outer", outer)
    await tasks.drain()
    assert done == ["outer", "nested"]
    assert tasks.pending == 0


async def test_a_periodic_task_repeats_survives_failures_and_stops() -> None:
    """Slice 10: the SLA sweep loop. Failures are logged and the loop keeps going."""
    runs: list[int] = []
    enough = asyncio.Event()

    async def job() -> None:
        runs.append(len(runs))
        if len(runs) == 2:
            raise RuntimeError("boom")
        if len(runs) >= 3:
            enough.set()

    task = PeriodicTask("sweep", 0.001, job)
    task.start()
    task.start()  # idempotent
    assert task.running
    await asyncio.wait_for(enough.wait(), timeout=2)
    await task.stop()
    assert not task.running
    done = len(runs)
    await asyncio.sleep(0.01)
    assert len(runs) == done  # stopped for good
    await task.stop()  # twice is fine
    with pytest.raises(ValueError, match="positive"):
        PeriodicTask("never", 0, job)

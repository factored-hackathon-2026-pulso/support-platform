"""In-process background tasks: run detached, isolate failures, drain nested jobs."""

from __future__ import annotations

from cc_platform.infrastructure.background import AsyncioBackgroundTasks


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

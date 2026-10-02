"""In-process ``BackgroundTasks`` adapter (``asyncio`` tasks with kept references).

Each job runs as its own task on the running loop; failures are logged, never raised to the
publisher. ``drain()`` waits until no job is pending (tests, shutdown), including jobs
spawned by jobs (e.g. routing a case whose commit triggers more work).
"""

from __future__ import annotations

import asyncio

import structlog

from cc_platform.application.ports.background import Job

_log = structlog.get_logger(__name__)


class AsyncioBackgroundTasks:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()

    def spawn(self, name: str, job: Job) -> None:
        task = asyncio.get_running_loop().create_task(self._run(name, job), name=name)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, name: str, job: Job) -> None:
        try:
            await job()
        except Exception:
            _log.exception("background_job_failed", job=name)

    async def drain(self) -> None:
        while self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)

    @property
    def pending(self) -> int:
        return len(self._tasks)

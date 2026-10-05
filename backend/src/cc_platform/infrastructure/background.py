"""In-process ``BackgroundTasks`` adapter (``asyncio`` tasks with kept references).

Each job runs as its own task on the running loop; failures are logged, never raised to the
publisher. ``drain()`` waits until no job is pending (tests, shutdown), including jobs
spawned by jobs (e.g. a queue drain whose commits trigger more work).
"""

from __future__ import annotations

import asyncio
import contextlib

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
            running = [task for task in self._tasks if not task.done()]
            if running:
                await asyncio.gather(*running, return_exceptions=True)
            else:
                # Every task is done but its done callback (the one that forgets it) has not run:
                # ``gather`` of finished tasks never yields, so without this the loop spins forever.
                await asyncio.sleep(0)

    async def drain_or_cancel(self, grace_seconds: float) -> int:
        """``drain`` for at most ``grace_seconds``, then cancel what is left (graceful
        shutdown); returns how many jobs were cancelled."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + grace_seconds
        while self._tasks:
            running = [task for task in self._tasks if not task.done()]
            if not running:
                await asyncio.sleep(0)  # let the done callbacks forget finished tasks
                continue
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            await asyncio.wait(running, timeout=remaining)  # never cancels them
        leftover = [task for task in self._tasks if not task.done()]
        for task in leftover:
            task.cancel()
        await asyncio.gather(*leftover, return_exceptions=True)
        if leftover:
            _log.warning("background_jobs_cancelled", count=len(leftover))
        return len(leftover)

    @property
    def pending(self) -> int:
        return len(self._tasks)


class PeriodicTask:
    """Runs ``job`` every ``interval`` seconds on the running loop until ``stop`` (e.g. the
    slice 10 SLA sweep). Not part of ``AsyncioBackgroundTasks``: ``drain()`` waits for
    one-shot jobs only, and a loop never ends on its own. Failures are logged and the loop
    keeps going."""

    def __init__(self, name: str, interval: float, job: Job) -> None:
        if interval <= 0:
            raise ValueError("interval must be positive")
        self._name = name
        self._interval = interval
        self._job = job
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._loop(), name=self._name)

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            try:
                await self._job()
            except Exception:
                _log.exception("periodic_job_failed", job=self._name)

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

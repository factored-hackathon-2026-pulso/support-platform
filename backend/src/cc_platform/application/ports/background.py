"""Background work port: run a job after the current request without making it wait.

Used by process managers (bus subscribers) for work a command triggers but must not block
on, e.g. routing a case after ``case.opened`` (the customer's POST never waits for it).
The in-process adapter keeps a reference to every task (so none is garbage-collected
mid-flight), logs failures, and can ``drain()`` pending jobs (tests, shutdown). A
multi-process deployment swaps it for a queue behind the same port.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

type Job = Callable[[], Awaitable[object]]


class BackgroundTasks(Protocol):
    def spawn(self, name: str, job: Job) -> None:
        """Schedule ``job``; it must be safe to run twice (idempotent on fresh state)."""
        ...

"""Argon2id password hashing (``PasswordHasher`` port). CPU work runs in a worker thread."""

from __future__ import annotations

import asyncio
from functools import cached_property

from argon2 import PasswordHasher as Argon2Hasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_DUMMY_PASSWORD = "not-a-real-password"  # noqa: S105 - used only to equalise timing


class Argon2PasswordHasher:
    def __init__(
        self, *, time_cost: int = 3, memory_cost: int = 65536, parallelism: int = 4
    ) -> None:
        self._hasher = Argon2Hasher(
            time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism
        )

    @cached_property
    def _dummy_hash(self) -> str:
        return self._hasher.hash(_DUMMY_PASSWORD)

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(self._hasher.hash, password)

    async def verify(self, password_hash: str | None, password: str) -> bool:
        target = password_hash if password_hash is not None else self._dummy_hash
        matches = await asyncio.to_thread(self._verify_sync, target, password)
        return matches and password_hash is not None

    def _verify_sync(self, password_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

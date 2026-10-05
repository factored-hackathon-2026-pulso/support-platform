"""W3C Trace Context (``traceparent`` / ``tracestate``) for the calls the platform makes to the
Core (deploy brief P4).

The platform does no tracing of its own (no spans, no Langfuse): it only carries a trace id so a
customer's message, the platform's logs and the Core's trace of the same turn share one id.

- An incoming request with a valid ``traceparent`` keeps its trace id (and its ``tracestate``);
  without one, the request starts a new trace. ``RequestContextMiddleware`` binds it for the
  request (and the background jobs the request spawns inherit it: asyncio copies the context).
- Every call to the Core sends ``traceparent`` with that trace id and a fresh parent id (the
  platform's call is a new span of the trace); ``tracestate`` is forwarded untouched.

Pure standard library: the api middleware and the infrastructure HTTP hook both use it.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace

TRACEPARENT = "traceparent"
TRACESTATE = "tracestate"

_TRACEPARENT = re.compile(
    r"^(?P<version>[0-9a-f]{2})-(?P<trace>[0-9a-f]{32})-(?P<parent>[0-9a-f]{16})-"
    r"(?P<flags>[0-9a-f]{2})(?P<rest>-.*)?$"
)
#: ``tracestate`` is forwarded only when it is plausible (printable ASCII, W3C's 512-char cap).
_TRACESTATE = re.compile(r"^[\x20-\x7e]{1,512}$")
_ZERO_TRACE = "0" * 32
_ZERO_PARENT = "0" * 16


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str
    """32 lowercase hex characters, never all zeros."""
    parent_id: str
    """16 lowercase hex characters: the caller's span (ours, on an outgoing call)."""
    flags: str = "01"
    state: str | None = None

    @property
    def traceparent(self) -> str:
        return f"00-{self.trace_id}-{self.parent_id}-{self.flags}"

    def child(self) -> TraceContext:
        """The same trace with a new parent id: what one outgoing call sends."""
        return replace(self, parent_id=_new_parent_id())

    def headers(self) -> dict[str, str]:
        headers = {TRACEPARENT: self.traceparent}
        if self.state:
            headers[TRACESTATE] = self.state
        return headers


def _new_parent_id() -> str:
    while True:
        value = secrets.token_hex(8)
        if value != _ZERO_PARENT:
            return value


def new_trace() -> TraceContext:
    """A new trace (sampled), for a request or a job that arrived without one."""
    while True:
        trace_id = secrets.token_hex(16)
        if trace_id != _ZERO_TRACE:
            return TraceContext(trace_id=trace_id, parent_id=_new_parent_id())


def parse_trace(traceparent: str | None, tracestate: str | None = None) -> TraceContext | None:
    """The context of a valid ``traceparent`` (W3C level 1), or ``None``.

    Version ``ff`` and all-zero ids are invalid; version ``00`` has exactly four fields, a later
    version may add more (they are ignored). ``tracestate`` is kept only with a valid parent."""
    if traceparent is None:
        return None
    match = _TRACEPARENT.match(traceparent.strip())
    if match is None:
        return None
    version, rest = match["version"], match["rest"]
    if version == "ff" or (version == "00" and rest is not None):
        return None
    if match["trace"] == _ZERO_TRACE or match["parent"] == _ZERO_PARENT:
        return None
    state = tracestate.strip() if tracestate is not None else None
    return TraceContext(
        trace_id=match["trace"],
        parent_id=match["parent"],
        flags=match["flags"],
        state=state if state and _TRACESTATE.match(state) else None,
    )


_current: ContextVar[TraceContext | None] = ContextVar("cc_trace_context", default=None)


def current_trace() -> TraceContext | None:
    """The trace of the running request or job, if one was bound."""
    return _current.get()


@contextmanager
def use_trace(context: TraceContext) -> Iterator[TraceContext]:
    """Bind ``context`` as the current trace for the block (and the tasks it spawns)."""
    token = _current.set(context)
    try:
        yield context
    finally:
        _current.reset(token)

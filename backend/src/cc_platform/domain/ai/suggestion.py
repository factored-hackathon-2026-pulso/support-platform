"""``CopilotSuggestion``: what the copilot proposes for a case and what the analyst did (ADR 0005).

Unlike the Q&A thread (``CopilotThread``), a suggestion is one agent-core run that reads the
recent conversation and answers a typed list: a ``reply`` draft, ``tool`` reads to look at, an
``action`` prepared but **not executable**, and an ``escalate`` recommendation. The list may be
empty: not every message deserves a suggestion (``status`` ``none`` is a normal answer).

Nothing here sends or executes anything. The analyst sends a draft herself; an escalation
recommendation only fills the escalation dialog.

What is kept (ADR 0005 §7): types, tool ids, a hash of the draft and what the analyst decided with
the edit distance between the draft and what she sent. The texts (the draft, a motive, evidence, an
action's summary) live here only until the draft is decided or ``DRAFT_TTL`` passes, then
``purge`` clears them. The events carry ids, enums and counters: never a text.
"""

from __future__ import annotations

import difflib
import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import ClassVar

from cc_platform.domain.ai.events import (
    CopilotSuggestionDecided,
    CopilotSuggestionFailed,
    CopilotSuggestionNone,
    CopilotSuggestionReady,
    CopilotSuggestionRequested,
)
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

#: A draft is kept only this long (or until it is decided): long enough to compare it with what the
#: analyst sends.
DRAFT_TTL = timedelta(hours=24)

#: At most this many are kept (the screen has no room for more). When agent-core sends more, the
#: reply and the escalation stay and ``truncated`` says so.
MAX_SUGGESTIONS = 3
MAX_REPLY = 4000
MAX_LINE = 500
MAX_ID = 120
MAX_SUMMARY = 300
MAX_EVIDENCE = 5
MAX_CITATIONS = 10
MAX_FAILURE_CODE = 60

#: Readable names of the tools the copilot may propose (agent-core sends none). A tool that is not
#: here shows its own name. Keyed by the tool's id, without its ``@version``.
TOOL_LABELS: dict[str, str] = {
    "leer_movimientos": "Movimientos",
    "leer_productos": "Productos",
    "leer_pqr_cliente": "Reclamos del cliente",
    "obtener_handoff": "Traspaso del asistente",
    "leer_transcript": "Conversación con el asistente",
}


class SuggestionTrigger(StrEnum):
    CUSTOMER_MESSAGE = "customer_message"
    MANUAL = "manual"
    HANDOVER = "handover"


class SuggestionStatus(StrEnum):
    PREPARING = "preparing"
    READY = "ready"
    NONE = "none"
    """agent-core had nothing to propose (greeting, nothing new): a normal answer."""
    FAILED = "failed"


class ReplyDecision(StrEnum):
    USED = "used"
    """Sent as proposed."""
    EDITED = "edited"
    """Sent after changes (``edit_distance_permille`` says how many)."""
    DISCARDED = "discarded"
    """The analyst dismissed it."""
    IGNORED = "ignored"
    """Nobody decided: a newer suggestion replaced it, or it expired."""


@dataclass(frozen=True, slots=True)
class ReplySuggestion:
    """A draft for the customer. The analyst sends it; the platform never does."""

    kind: ClassVar[str] = "reply"
    text: str
    citations: tuple[str, ...] = ()
    language: str = "es"


@dataclass(frozen=True, slots=True)
class ToolSuggestion:
    """A read worth looking at (a tool of the copilot's catalog): *Usar* asks the copilot."""

    kind: ClassVar[str] = "tool"
    tool: str
    label: str = ""
    why: str = ""


@dataclass(frozen=True, slots=True)
class ActionSuggestion:
    """A write prepared and **not executable** in this stage (ADR 0005 §3): information only."""

    kind: ClassVar[str] = "action"
    tool: str
    summary: str


@dataclass(frozen=True, slots=True)
class EscalationSuggestion:
    """A recommendation to escalate: it comes from agent-core's rules, with reason and evidence."""

    kind: ClassVar[str] = "escalate"
    reason_code: str
    evidence: tuple[str, ...] = ()
    motive_draft: str = ""


type Suggestion = ReplySuggestion | ToolSuggestion | ActionSuggestion | EscalationSuggestion


def _clip(text: str, limit: int) -> tuple[str, bool]:
    """The text cleaned and cut to ``limit``, and whether anything was cut."""
    cleaned = " ".join(text.split()) if limit <= MAX_LINE else text.strip()
    return cleaned[:limit], len(cleaned) > limit


def tool_label(tool: str) -> str:
    """The readable name of a tool (``leer_movimientos@1`` is "Movimientos"): the platform's own
    catalog, else the tool's name without its version. agent-core does not send a label."""
    name = tool.strip().partition("@")[0]
    return TOOL_LABELS.get(name) or name or tool.strip()


@dataclass(frozen=True, slots=True)
class NormalizedSuggestions:
    items: tuple[Suggestion, ...]
    truncated: bool
    """Something real was left out or cut: a second reply or escalation, more than
    ``MAX_SUGGESTIONS``, or a text longer than its limit. An empty or unknown item is not a cut."""


def _clean_reply(item: ReplySuggestion) -> tuple[Suggestion | None, bool]:
    text, cut = _clip(item.text, MAX_REPLY)
    if not text:
        return None, False
    citations = tuple(c.strip() for c in item.citations if c.strip())
    cut = cut or len(citations) > MAX_CITATIONS or any(len(c) > MAX_ID for c in citations)
    reply = ReplySuggestion(
        text=text,
        citations=tuple(c[:MAX_ID] for c in citations[:MAX_CITATIONS]),
        language=item.language.strip()[:8] or "es",
    )
    return reply, cut


def _clean_tool(item: ToolSuggestion) -> tuple[Suggestion | None, bool]:
    tool, tool_cut = _clip(item.tool, MAX_ID)
    if not tool:
        return None, False
    why, why_cut = _clip(item.why, MAX_LINE)
    return ToolSuggestion(tool=tool, label=tool_label(tool), why=why), tool_cut or why_cut


def _clean_action(item: ActionSuggestion) -> tuple[Suggestion | None, bool]:
    tool, tool_cut = _clip(item.tool, MAX_ID)
    summary, summary_cut = _clip(item.summary, MAX_SUMMARY)
    if not tool or not summary:
        return None, False
    return ActionSuggestion(tool=tool, summary=summary), tool_cut or summary_cut


def _clean_escalation(item: EscalationSuggestion) -> tuple[Suggestion | None, bool]:
    code, code_cut = _clip(item.reason_code, MAX_ID)
    if not code:
        return None, False
    lines = [_clip(e, MAX_SUMMARY) for e in item.evidence if e.strip()]
    motive, motive_cut = _clip(item.motive_draft, MAX_LINE)
    cut = code_cut or motive_cut or len(lines) > MAX_EVIDENCE or any(c for _, c in lines)
    escalation = EscalationSuggestion(
        reason_code=code,
        evidence=tuple(text for text, _ in lines[:MAX_EVIDENCE]),
        motive_draft=motive,
    )
    return escalation, cut


def _clean(item: Suggestion) -> tuple[Suggestion | None, bool]:
    if isinstance(item, ReplySuggestion):
        return _clean_reply(item)
    if isinstance(item, ToolSuggestion):
        return _clean_tool(item)
    if isinstance(item, ActionSuggestion):
        return _clean_action(item)
    if isinstance(item, EscalationSuggestion):
        return _clean_escalation(item)
    return None, False


def normalize_report(raw: Sequence[Suggestion]) -> NormalizedSuggestions:
    """What agent-core proposed, cleaned: empty texts dropped, long ones cut, one reply and one
    escalation at most, ``MAX_SUGGESTIONS`` in all (the reply and the escalation come first, then
    the others in the order given; the result keeps the original order). An unknown shape is
    dropped. ``truncated`` says whether any of that cut something real: it is never silent."""
    kept: list[Suggestion] = []
    truncated = False
    for item in raw:
        cleaned, cut = _clean(item)
        if cleaned is None:
            continue
        repeated = isinstance(cleaned, ReplySuggestion | EscalationSuggestion) and any(
            type(cleaned) is type(other) for other in kept
        )
        if repeated:  # a second reply or escalation is left out
            truncated = True
            continue
        kept.append(cleaned)
        truncated = truncated or cut
    if len(kept) > MAX_SUGGESTIONS:
        truncated = True
        wanted = {
            i for i, x in enumerate(kept) if isinstance(x, ReplySuggestion | EscalationSuggestion)
        }
        for i in range(len(kept)):
            if len(wanted) >= MAX_SUGGESTIONS:
                break
            wanted.add(i)
        kept = [x for i, x in enumerate(kept) if i in wanted]
    return NormalizedSuggestions(tuple(kept), truncated)


def normalize_suggestions(raw: Sequence[Suggestion]) -> tuple[Suggestion, ...]:
    return normalize_report(raw).items


def text_hash(text: str) -> str:
    """SHA-256 of a draft (trimmed): all that is kept of it once it is purged."""
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def edit_distance_permille(draft: str, sent: str) -> int:
    """How far what was sent is from the draft: 0 = the same, 1000 = nothing in common."""
    ratio = difflib.SequenceMatcher(None, draft.strip(), sent.strip(), autojunk=False).ratio()
    return max(0, min(1000, 1000 - round(ratio * 1000)))


@dataclass(eq=False)
class CopilotSuggestion(AggregateRoot):
    id: str
    case_id: str
    analyst_id: str
    agent: str
    """The agent asked (``id@alias``), e.g. ``copiloto-sugerencias@prod``."""
    trigger: SuggestionTrigger
    based_on_sequence: int
    """The last turn of the case it read: a later customer message makes it stale."""
    created_at: datetime
    updated_at: datetime
    status: SuggestionStatus = SuggestionStatus.PREPARING
    request_key: str | None = None
    """The ``Idempotency-Key`` of a manual request (a retry asks nothing twice)."""
    items: tuple[Suggestion, ...] = ()
    """The texts. Cleared by ``purge`` (and the reply by its decision)."""
    kinds: tuple[str, ...] = ()
    """What was proposed, kept after the texts are gone."""
    tool_ids: tuple[str, ...] = ()
    reply_hash: str | None = None
    reply_decision: ReplyDecision | None = None
    edit_distance_permille: int | None = None
    escalation_accepted: bool = False
    truncated: bool = False
    """agent-core proposed more than was kept (see ``normalize_report``): said, never silent."""
    run_id: str | None = None
    trace_id: str | None = None
    release: str | None = None
    """The agent release that answered (agent-core's run), kept for outcome attribution."""
    failure_code: str | None = None
    purged_at: datetime | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.COPILOT_SUGGESTION)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.analyst_id, IdPrefix.STAFF)

    # ------------------------------------------------------------------ creation
    @classmethod
    def request(
        cls,
        *,
        suggestion_id: str,
        case_id: str,
        analyst_id: str,
        agent: str,
        trigger: SuggestionTrigger,
        based_on_sequence: int,
        request_key: str | None,
        at: datetime,
    ) -> CopilotSuggestion:
        suggestion = cls(
            id=suggestion_id,
            case_id=case_id,
            analyst_id=analyst_id,
            agent=agent,
            trigger=trigger,
            based_on_sequence=based_on_sequence,
            request_key=request_key,
            created_at=at,
            updated_at=at,
        )
        suggestion._record_requested(at)
        return suggestion

    def restart(self, *, based_on_sequence: int, at: datetime) -> None:
        """A failed manual request is asked again (same key): back to preparing."""
        if self.status is not SuggestionStatus.FAILED:
            raise InvalidValueError("Only a failed suggestion can be asked again.", field="status")
        self.status = SuggestionStatus.PREPARING
        self.failure_code = None
        self.based_on_sequence = based_on_sequence
        self.updated_at = at
        self._record_requested(at)

    def _record_requested(self, at: datetime) -> None:
        actor = (
            ActorRef(ActorRole.ANALYST, self.analyst_id)
            if self.trigger is SuggestionTrigger.MANUAL
            else ActorRef.system()
        )
        self._record(
            CopilotSuggestionRequested(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.analyst_id,
                trigger=self.trigger.value,
                based_on_sequence=self.based_on_sequence,
            )
        )

    # ------------------------------------------------------------------ the answer
    def record_answer(
        self,
        *,
        raw: Sequence[Suggestion],
        run_id: str | None,
        trace_id: str,
        at: datetime,
        release: str | None = None,
    ) -> None:
        """agent-core answered: ``ready`` with something, ``none`` with nothing."""
        self._require_preparing()
        self.release = release
        report = normalize_report(raw)
        items = report.items
        self.truncated = report.truncated
        self.run_id = run_id
        self.trace_id = trace_id
        self.updated_at = at
        if not items:
            self.status = SuggestionStatus.NONE
            self._record(
                CopilotSuggestionNone(
                    occurred_at=at,
                    actor=ActorRef.system(),
                    entity_id=self.id,
                    case_id=self.case_id,
                    analyst_id=self.analyst_id,
                    agent=self.agent,
                    run_id=run_id,
                    trace_id=trace_id,
                    release=release,
                )
            )
            return
        self.status = SuggestionStatus.READY
        self.items = items
        self.kinds = tuple(dict.fromkeys(item.kind for item in items))
        self.tool_ids = tuple(
            dict.fromkeys(i.tool for i in items if isinstance(i, ToolSuggestion | ActionSuggestion))
        )
        reply = self._reply()
        self.reply_hash = text_hash(reply.text) if reply is not None else None
        self._record(
            CopilotSuggestionReady(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.analyst_id,
                agent=self.agent,
                kinds=self.kinds,
                count=len(items),
                truncated=self.truncated,
                run_id=run_id,
                trace_id=trace_id,
                release=release,
            )
        )

    def record_failure(self, *, code: str, at: datetime) -> None:
        """The call failed (``code`` is a problem code, never a message)."""
        self._require_preparing()
        self.status = SuggestionStatus.FAILED
        self.failure_code = code.strip()[:MAX_FAILURE_CODE] or "unknown"
        self.updated_at = at
        self._record(
            CopilotSuggestionFailed(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.analyst_id,
                failure_code=self.failure_code,
            )
        )

    def _require_preparing(self) -> None:
        if self.status is not SuggestionStatus.PREPARING:
            raise InvalidValueError("The suggestion is not being prepared.", field="status")

    # ------------------------------------------------------------------ queries
    def _reply(self) -> ReplySuggestion | None:
        return next((i for i in self.items if isinstance(i, ReplySuggestion)), None)

    @property
    def reply_pending(self) -> bool:
        """There is a draft nobody decided about yet."""
        return (
            self.status is SuggestionStatus.READY
            and self.reply_decision is None
            and self._reply() is not None
        )

    @property
    def recommends_escalation(self) -> bool:
        return any(isinstance(i, EscalationSuggestion) for i in self.items)

    def is_expired(self, now: datetime) -> bool:
        return now - self.created_at >= DRAFT_TTL

    # ------------------------------------------------------------------ what the analyst did
    def reply_sent(self, *, sent_text: str, at: datetime, turn_id: str | None = None) -> bool:
        """She sent a message that came from this draft. ``used`` if it is the draft, ``edited``
        (with the distance) if she changed it. ``turn_id`` is the turn she sent (it travels in the
        event, not the text). Returns whether anything changed."""
        reply = self._reply()
        if not self.reply_pending or reply is None:
            return False
        if sent_text.strip() == reply.text.strip():
            decision, distance = ReplyDecision.USED, 0
        else:
            decision = ReplyDecision.EDITED
            distance = edit_distance_permille(reply.text, sent_text)
        self.edit_distance_permille = distance
        self._decide_reply(
            decision, ActorRef(ActorRole.ANALYST, self.analyst_id), at, turn_id=turn_id
        )
        return True

    def discard_reply(self, *, at: datetime) -> bool:
        """She dismissed the draft."""
        if not self.reply_pending:
            return False
        self._decide_reply(
            ReplyDecision.DISCARDED, ActorRef(ActorRole.ANALYST, self.analyst_id), at
        )
        return True

    def ignore_reply(self, *, at: datetime) -> bool:
        """Nobody decided (a newer suggestion arrived, the case closed): kept as ``ignored``."""
        if not self.reply_pending:
            return False
        self._decide_reply(ReplyDecision.IGNORED, ActorRef.system(), at)
        return True

    def _decide_reply(
        self,
        decision: ReplyDecision,
        actor: ActorRef,
        at: datetime,
        *,
        turn_id: str | None = None,
    ) -> None:
        self.reply_decision = decision
        self.items = tuple(i for i in self.items if not isinstance(i, ReplySuggestion))
        self.updated_at = at
        self._record(
            CopilotSuggestionDecided(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                subject="reply",
                decision=decision.value,
                edit_distance_permille=self.edit_distance_permille,
                turn_id=turn_id,
                agent=self.agent,
                release=self.release,
            )
        )

    def escalation_taken(self, *, at: datetime) -> bool:
        """She escalated using this recommendation. Returns whether anything changed."""
        if (
            self.status is not SuggestionStatus.READY
            or not self.recommends_escalation
            or self.escalation_accepted
        ):
            return False
        self.escalation_accepted = True
        self.updated_at = at
        self._record(
            CopilotSuggestionDecided(
                occurred_at=at,
                actor=ActorRef(ActorRole.ANALYST, self.analyst_id),
                entity_id=self.id,
                case_id=self.case_id,
                subject="escalation",
                decision="accepted",
                agent=self.agent,
                release=self.release,
            )
        )
        return True

    def purge(self, *, at: datetime) -> bool:
        """Clear every text (the draft is kept 24 hours at most). An undecided draft becomes
        ``ignored``. What stays: kinds, tool ids, the draft's hash and the decisions."""
        if self.purged_at is not None or self.status is not SuggestionStatus.READY:
            return False
        self.ignore_reply(at=at)
        self.items = ()
        self.purged_at = at
        self.updated_at = at
        return True

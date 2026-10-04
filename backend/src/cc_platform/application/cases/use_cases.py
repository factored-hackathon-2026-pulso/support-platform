"""The use cases of the cases context, as one bundle the composition root builds."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.analyst_home import GetAnalystHome
from cc_platform.application.cases.commands import CloseCase, MarkCaseRead, PostAnalystTurn
from cc_platform.application.cases.customer_chat import (
    GetCustomerConversation,
    GetPastConversation,
    ListPastConversations,
    PostCustomerTurn,
    RateConversation,
)
from cc_platform.application.cases.escalations import (
    AcknowledgeEscalation,
    EscalateCase,
    GetEscalationOverview,
    RespondEscalation,
    TakeEscalatedCase,
    WithdrawEscalation,
)
from cc_platform.application.cases.manual_assignment import SetCaseAssignee
from cc_platform.application.cases.priority import ChangeCasePriority
from cc_platform.application.cases.queries import (
    AuthorizeCaseSubscription,
    GetCaseDetail,
    GetCaseHistory,
    GetInbox,
    ListCaseTurns,
)
from cc_platform.application.cases.supervision import (
    GetLanguageOpenCases,
    GetQueueOverview,
    GetTeamOverview,
)


@dataclass(frozen=True, slots=True)
class CasesUseCases:
    inbox: GetInbox
    detail: GetCaseDetail
    history: GetCaseHistory
    turns: ListCaseTurns
    post_analyst_turn: PostAnalystTurn
    mark_read: MarkCaseRead
    close: CloseCase
    customer_conversation: GetCustomerConversation
    post_customer_turn: PostCustomerTurn
    past_conversations: ListPastConversations
    past_conversation: GetPastConversation
    authorize_subscription: AuthorizeCaseSubscription
    team_overview: GetTeamOverview
    queue_overview: GetQueueOverview
    set_assignee: SetCaseAssignee
    analyst_home: GetAnalystHome
    rate_conversation: RateConversation
    change_priority: ChangeCasePriority
    # slice 9: "Colas" and escalations
    language_open_cases: GetLanguageOpenCases
    escalate: EscalateCase
    withdraw_escalation: WithdrawEscalation
    acknowledge_escalation: AcknowledgeEscalation
    respond_escalation: RespondEscalation
    take_escalated_case: TakeEscalatedCase
    escalation_overview: GetEscalationOverview

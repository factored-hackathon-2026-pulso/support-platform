"""The use cases of the cases context, as one bundle the composition root builds."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.commands import CloseCase, MarkCaseRead, PostAnalystTurn
from cc_platform.application.cases.customer_chat import GetCustomerConversation, PostCustomerTurn
from cc_platform.application.cases.queries import (
    AuthorizeCaseSubscription,
    GetCaseDetail,
    GetInbox,
    ListCaseTurns,
)


@dataclass(frozen=True, slots=True)
class CasesUseCases:
    inbox: GetInbox
    detail: GetCaseDetail
    turns: ListCaseTurns
    post_analyst_turn: PostAnalystTurn
    mark_read: MarkCaseRead
    close: CloseCase
    customer_conversation: GetCustomerConversation
    post_customer_turn: PostCustomerTurn
    authorize_subscription: AuthorizeCaseSubscription

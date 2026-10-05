"""The signed-in person's own settings (slice 23: the UI language), for every staff role."""

from __future__ import annotations

from fastapi import APIRouter

from cc_platform.api.dependencies import ApiContextDep, CurrentActor
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.preferences import Preferences, UpdatePreferencesRequest

router = APIRouter(prefix="/me", tags=["preferences"])


@router.get(
    "/preferences",
    response_model=Preferences,
    summary="My preferences (never changed = the defaults)",
    responses=problem_responses(401),
)
async def get_preferences(actor: CurrentActor, api: ApiContextDep) -> Preferences:
    return Preferences.from_view(await api.use_cases.people.get_preferences.execute(actor))


@router.put(
    "/preferences",
    response_model=Preferences,
    summary="Change my preferences (same value = no change, no event)",
    description=(
        "Records `staff.ui_language_changed` (audited) and sends `preferences.updated` to her "
        "other sessions on `staff:<id>`."
    ),
    responses=problem_responses(401, 422),
)
async def set_preferences(
    body: UpdatePreferencesRequest, actor: CurrentActor, api: ApiContextDep
) -> Preferences:
    view = await api.use_cases.people.set_preferences.execute(actor, body.ui_language)
    return Preferences.from_view(view)

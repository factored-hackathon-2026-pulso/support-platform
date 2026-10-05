"""A person's own settings of the platform (slice 23: the UI language)."""

from __future__ import annotations

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.people.preferences import PreferencesView
from cc_platform.domain.people.preferences import UiLanguage


class Preferences(ApiModel):
    """Her own settings (in ``/auth/me``; live as ``preferences.updated`` on ``staff:<id>``)."""

    ui_language: UiLanguage = Field(
        description="The language of her platform UI (BCP 47): `es` (default) or `pt-BR`. "
        "Never the language of the conversations."
    )

    @classmethod
    def from_view(cls, view: PreferencesView) -> Preferences:
        return cls(ui_language=view.ui_language)

    @classmethod
    def of(cls, ui_language: UiLanguage) -> Preferences:
        return cls(ui_language=ui_language)


class UpdatePreferencesRequest(RequestModel):
    ui_language: UiLanguage

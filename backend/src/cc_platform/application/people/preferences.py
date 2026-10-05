"""A person's own settings of the platform (slice 23: the UI language).

Any staff member reads and changes her own (``GET|PUT /me/preferences``); the change is an
event (``staff.ui_language_changed``, audited like her other self changes) and reaches her
other sessions as ``preferences.updated`` on ``staff:<id>``. ``ui_language_of`` is the one
server-side reader: the texts the server renders for a person follow it in a later phase.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.preferences import StaffPreferences, UiLanguage


@dataclass(frozen=True, slots=True)
class PreferencesView:
    ui_language: UiLanguage

    @classmethod
    def of(cls, preferences: StaffPreferences) -> PreferencesView:
        return cls(ui_language=preferences.ui_language)


async def preferences_of(uow: UnitOfWork, staff_id: str) -> StaffPreferences:
    """Her stored preferences, or the defaults when she never changed them."""
    return await uow.preferences.get(staff_id) or StaffPreferences.default(staff_id)


async def ui_language_of(uow: UnitOfWork, staff_id: str) -> UiLanguage:
    """The language the platform speaks to her (server-rendered texts, later phase)."""
    return (await preferences_of(uow, staff_id)).ui_language


@dataclass(frozen=True, slots=True)
class GetMyPreferences:
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor) -> PreferencesView:
        async with self.uow() as uow:
            return PreferencesView.of(await preferences_of(uow, actor.staff_id))


@dataclass(frozen=True, slots=True)
class SetMyPreferences:
    """Same language = no change, no event."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, ui_language: UiLanguage) -> PreferencesView:
        return await retry_on_conflict(lambda: self._attempt(actor, ui_language))

    async def _attempt(self, actor: Actor, ui_language: UiLanguage) -> PreferencesView:
        now = self.clock.now()
        async with self.uow() as uow:
            stored = await uow.preferences.get(actor.staff_id)
            preferences = stored or StaffPreferences.default(actor.staff_id)
            changed = preferences.set_ui_language(ui_language, now=now, actor=actor.acting_as())
            if changed and stored is None:
                await uow.preferences.add(preferences)
            elif changed:
                await uow.preferences.save(preferences)
            await uow.commit()
        return PreferencesView.of(preferences)

"""Seed customers — "Datos de ejemplo" (slice 2 contract §8.2).

Every name, id and city pairing here is invented (brief §4.7: never copy customer records
from the dataset). 1001–1008 are the people of the seeded cases (Daniela's inbox, Julián's
old case and the Portuguese queue); 2001–2005 are fresh simulator customers. Opener chips
are written in each customer's own voice (es-CO, es-MX, es-AR with voseo, pt-BR). Minimal
profile only: no documents, segments, phones or emails.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.customers.customer import CountryCode, Customer, CustomerLocale
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id

CO, MX, AR, BR = CountryCode.CO, CountryCode.MX, CountryCode.AR, CountryCode.BR
ES_CO, ES_MX, ES_AR, PT_BR = (
    CustomerLocale.ES_CO,
    CustomerLocale.ES_MX,
    CustomerLocale.ES_AR,
    CustomerLocale.PT_BR,
)


def seed_customer_id(number: int) -> str:
    """Stable ids (``CUS-000…1001``) so restarts and UI links keep working."""
    return make_id(IdPrefix.CUSTOMER, str(number).zfill(BODY_LENGTH))


@dataclass(frozen=True, slots=True)
class CustomerSeed:
    number: int
    name: str
    locale: CustomerLocale
    city: str
    country: CountryCode
    simulator: bool = False
    suggestions: tuple[str, ...] = ()

    @property
    def id(self) -> str:
        return seed_customer_id(self.number)

    def to_customer(self) -> Customer:
        return Customer(
            id=self.id,
            display_name=self.name,
            country=self.country,
            city=self.city,
            locale=self.locale,
            simulator=self.simulator,
            suggestions=self.suggestions,
        )


DEMO_CUSTOMERS: tuple[CustomerSeed, ...] = (
    # People of the seeded cases (§8.3). The simulator can continue (or reopen) each one.
    CustomerSeed(1001, "Marcela Quintana Pardo", ES_CO, "Barranquilla", CO,
                 suggestions=("¿Ya me pueden decir algo del retiro?", "Gracias, quedo atenta")),
    CustomerSeed(1002, "Beatriz Salcedo Prieto", ES_CO, "Cali", CO,
                 suggestions=("¿Hay alguien ahí?", "Llevo un buen rato esperando")),
    CustomerSeed(1003, "Larissa Monteiro Alves", PT_BR, "Medellín", CO,
                 suggestions=("Alguém pode me ajudar?", "Foi uma compra de ontem")),
    CustomerSeed(1004, "Patricia Lozano Vega", ES_MX, "Guadalajara", MX,
                 suggestions=("¿Ya pudieron revisarlo?", "Gracias por la ayuda")),
    CustomerSeed(1005, "Claudia Restrepo Varela", ES_CO, "Barranquilla", CO,
                 suggestions=("Hola, sigo con el problema del cargo",)),
    CustomerSeed(1006, "Héctor Villarreal Garza", ES_MX, "Monterrey", MX,
                 suggestions=("Hola de nuevo, tengo otra duda",)),
    CustomerSeed(1007, "Joaquín Ferreyra Paz", ES_AR, "Rosario", AR,
                 suggestions=("Fue a mediados de mes, unos $48.300", "¿Lo pudiste encontrar?")),
    CustomerSeed(1008, "Gabriela Duarte Melo", PT_BR, "São Paulo", BR,
                 suggestions=("Alguém aí?", "Ainda estou esperando")),
    # Fresh simulator customers: a first message opens a new case.
    CustomerSeed(2001, "Natalia Guzmán Rincón", ES_CO, "Bogotá", CO, simulator=True,
                 suggestions=("No reconozco un cargo en mi tarjeta",
                              "Me cobraron dos veces la misma compra",
                              "Quiero saber cómo va mi reclamo")),
    CustomerSeed(2002, "Ximena Robles Treviño", ES_MX, "Ciudad de México", MX, simulator=True,
                 suggestions=("Me aparece un cargo que no hice",
                              "Me cobraron de más en una compra",
                              "¿Me ayudan con un cargo que no reconozco?")),
    CustomerSeed(2003, "Lucas Benítez Sosa", ES_AR, "Córdoba", AR, simulator=True,
                 suggestions=("Hola, ¿me podés ayudar? Tengo un cargo que no reconozco",
                              "Me cobraron dos veces y necesito que me lo devuelvan",
                              "¿En qué quedó mi reclamo? Avisame, porfa")),
    CustomerSeed(2004, "Rafael Nogueira Costa", PT_BR, "Buenos Aires", AR, simulator=True,
                 suggestions=("Olá, não reconheço uma compra no meu cartão",
                              "Fui cobrado duas vezes pela mesma compra",
                              "Quero falar com uma pessoa")),
    CustomerSeed(2005, "Andrés Felipe Cardona", ES_CO, "Medellín", CO, simulator=True,
                 suggestions=("Hay un cargo en mi tarjeta que no reconozco",
                              "Necesito hablar con una persona")),
)  # fmt: skip


async def seed_demo_customers(
    uow: UnitOfWorkFactory, seeds: tuple[CustomerSeed, ...] = DEMO_CUSTOMERS
) -> int:
    """Insert missing seed customers. Idempotent; returns how many were created."""
    created = 0
    async with uow() as unit:
        for seed in seeds:
            if await unit.customers.get(seed.id) is not None:
                continue
            await unit.customers.add(seed.to_customer())
            created += 1
        await unit.commit()
    return created

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
    PostgresSystemRepository,
)
from app.catalog.domain import CatalogNotFound, CatalogRuleViolation, RiskLevel
from app.models import service_components

TODAY = date(2026, 7, 26)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    services = PostgresServiceRepository(db_session)
    svc = services.create(name="Connectivity", product_id=product.id)
    return {
        "db": db_session, "product": product, "service": svc,
        "services": services,
        "components": PostgresComponentRepository(db_session),
        "systems": PostgresSystemRepository(db_session),
    }


def test_tech_links_and_rollup(env):
    svc, services = env["service"], env["services"]
    pid = env["product"].id
    direct = env["components"].create(name="Direct", product_id=pid,
                                      end_of_support=TODAY + timedelta(days=30))
    member = env["components"].create(name="Member", product_id=pid,
                                      end_of_life=TODAY - timedelta(days=1))
    system = env["systems"].create(name="Fabric", product_id=pid)
    env["systems"].set_member(system.id, member.id)

    services.add_tech_component(svc.id, direct.id)
    services.add_tech_system(svc.id, system.id)
    tech = services.list_tech(svc.id, today=TODAY)
    assert [c.name for c in tech.components] == ["Direct"]
    assert [s.name for s in tech.systems] == ["Fabric"]
    assert tech.components[0].risk == RiskLevel.WARNING
    assert tech.risk == RiskLevel.DANGER  # via the system member

    with pytest.raises(CatalogRuleViolation):
        services.add_tech_component(svc.id, direct.id)  # duplicate
    with pytest.raises(CatalogRuleViolation):
        services.add_tech_component(svc.id, 999)

    services.remove_tech_system(svc.id, system.id)
    assert services.list_tech(svc.id, today=TODAY).risk == RiskLevel.WARNING
    with pytest.raises(CatalogNotFound):
        services.remove_tech_system(svc.id, system.id)


def test_component_delete_blocked_by_service_link(env):
    from app.catalog.domain import CatalogInUse

    c = env["components"].create(name="C", product_id=env["product"].id)
    env["services"].add_tech_component(env["service"].id, c.id)
    with pytest.raises(CatalogInUse):
        env["components"].delete(c.id)
    env["services"].remove_tech_component(env["service"].id, c.id)
    env["components"].delete(c.id)


def test_system_delete_blocked_by_service_link(env):
    from app.catalog.domain import CatalogInUse

    s = env["systems"].create(name="S", product_id=env["product"].id)
    env["services"].add_tech_system(env["service"].id, s.id)
    with pytest.raises(CatalogInUse):
        env["systems"].delete(s.id)


def test_service_delete_removes_link_rows(env):
    c = env["components"].create(name="C", product_id=env["product"].id)
    env["services"].add_tech_component(env["service"].id, c.id)
    env["services"].delete(env["service"].id)
    assert env["db"].scalar(select(func.count()).select_from(service_components)) == 0

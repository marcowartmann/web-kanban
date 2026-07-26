from datetime import date, timedelta

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresProductRepository,
    PostgresSystemRepository,
    PostgresVendorRepository,
    get_or_create_vendor_id,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    LifecycleStage,
    RiskLevel,
)

TODAY = date(2026, 7, 26)


@pytest.fixture()
def repos(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session,
        "products": products,
        "product": product,
        "components": PostgresComponentRepository(db_session),
        "systems": PostgresSystemRepository(db_session),
        "vendors": PostgresVendorRepository(db_session),
    }


def test_vendor_get_or_create(repos):
    a = get_or_create_vendor_id(repos["db"], "  Cisco ")
    b = get_or_create_vendor_id(repos["db"], "Cisco")
    assert a == b
    assert get_or_create_vendor_id(repos["db"], "  ") is None
    assert [v.name for v in repos["vendors"].list()] == ["Cisco"]


def test_component_crud_with_vendor_and_risk(repos):
    comps = repos["components"]
    c = comps.create(
        name="Catalyst 9300", product_id=repos["product"].id,
        vendor_name="Cisco", model="C9300-48P",
        end_of_support=TODAY + timedelta(days=30),
    )
    assert c.vendor_name == "Cisco"
    got = comps.get(c.id, today=TODAY)
    assert got.risk == RiskLevel.WARNING
    comps.update(c.id, {"end_of_support": TODAY - timedelta(days=1)})
    assert comps.get(c.id, today=TODAY).risk == RiskLevel.DANGER
    comps.update(c.id, {"vendor_name": None})
    assert comps.get(c.id).vendor_id is None
    with pytest.raises(CatalogRuleViolation):
        comps.create(name="Catalyst 9300", product_id=repos["product"].id)
    comps.delete(c.id)
    with pytest.raises(CatalogNotFound):
        comps.get(c.id)


def test_list_all_ordering(repos):
    comps = repos["components"]
    pid = repos["product"].id
    comps.create(name="NoDates", product_id=pid)
    comps.create(name="Soon", product_id=pid, end_of_support=TODAY + timedelta(days=10))
    comps.create(name="Dead", product_id=pid, end_of_life=TODAY - timedelta(days=10))
    comps.create(name="Later", product_id=pid, end_of_support=TODAY + timedelta(days=100))
    names = [c.name for c in comps.list_all(today=TODAY)]
    assert names == ["Dead", "Soon", "Later", "NoDates"]
    assert comps.list_all(today=TODAY)[0].product_name == "Network"


def test_system_membership_and_risk(repos):
    comps, systems = repos["components"], repos["systems"]
    pid = repos["product"].id
    c1 = comps.create(name="OK", product_id=pid)
    c2 = comps.create(name="Dying", product_id=pid, end_of_support=TODAY - timedelta(days=1))
    s = systems.create(name="Campus fabric", product_id=pid)
    systems.set_member(s.id, c1.id, quantity=10)
    got = systems.set_member(s.id, c2.id)
    assert {m.component.name for m in got.members} == {"OK", "Dying"}
    assert systems.get(s.id, today=TODAY).risk == RiskLevel.DANGER
    got = systems.set_member(s.id, c1.id, quantity=99)  # update quantity in place
    assert next(m for m in got.members if m.component.name == "OK").quantity == 99
    got = systems.remove_member(s.id, c2.id)
    assert {m.component.name for m in got.members} == {"OK"}
    with pytest.raises(CatalogNotFound):
        systems.remove_member(s.id, c2.id)


def test_member_must_share_product(repos):
    arts = PostgresArtRepository(repos["db"])
    other = repos["products"].create(name="Other", art_id=arts.list()[0].id)
    foreign = repos["components"].create(name="Foreign", product_id=other.id)
    s = repos["systems"].create(name="Sys", product_id=repos["product"].id)
    with pytest.raises(CatalogRuleViolation):
        repos["systems"].set_member(s.id, foreign.id)


def test_delete_guards(repos):
    comps, systems = repos["components"], repos["systems"]
    pid = repos["product"].id
    c = comps.create(name="C", product_id=pid)
    s = systems.create(name="S", product_id=pid)
    systems.set_member(s.id, c.id)
    with pytest.raises(CatalogInUse):
        comps.delete(c.id)  # member of a system
    systems.delete(s.id)  # memberships go with it
    comps.delete(c.id)  # now free


def test_product_delete_blocked_by_components(repos):
    comps = repos["components"]
    comps.create(name="C", product_id=repos["product"].id)
    with pytest.raises(CatalogInUse):
        repos["products"].delete(repos["product"].id)


def test_product_delete_blocked_by_system(repos):
    repos["systems"].create(name="OnlySys", product_id=repos["product"].id)
    with pytest.raises(CatalogInUse):
        repos["products"].delete(repos["product"].id)


def test_rename_duplicate_rules(repos):
    comps, systems = repos["components"], repos["systems"]
    pid = repos["product"].id
    comps.create(name="A", product_id=pid)
    c2 = comps.create(name="B", product_id=pid)
    with pytest.raises(CatalogRuleViolation):
        comps.update(c2.id, {"name": "A"})
    systems.create(name="SA", product_id=pid)
    s2 = systems.create(name="SB", product_id=pid)
    with pytest.raises(CatalogRuleViolation):
        systems.update(s2.id, {"name": "SA"})

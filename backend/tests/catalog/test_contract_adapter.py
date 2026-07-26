from datetime import date, timedelta

import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresContractRepository,
    PostgresProductRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    ContractStatus,
)

TODAY = date(2026, 7, 26)


@pytest.fixture()
def env(db_session):
    arts = PostgresArtRepository(db_session)
    products = PostgresProductRepository(db_session)
    art = arts.create(name="ART")
    product = products.create(name="Network", art_id=art.id)
    return {
        "db": db_session, "products": products, "product": product,
        "components": PostgresComponentRepository(db_session),
        "contracts": PostgresContractRepository(db_session),
    }


def test_contract_crud_with_vendor_and_status(env):
    contracts = env["contracts"]
    c = contracts.create(
        name="SmartNet", product_id=env["product"].id, vendor_name="Cisco",
        end_date=TODAY + timedelta(days=30), yearly_cost=15000,
    )
    assert c.vendor_name == "Cisco"
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.EXPIRING
    contracts.update(c.id, {"end_date": TODAY - timedelta(days=1)})
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.EXPIRED
    contracts.update(c.id, {"end_date": None})
    assert contracts.get(c.id, today=TODAY).status == ContractStatus.ACTIVE
    with pytest.raises(CatalogRuleViolation):
        contracts.create(name="SmartNet", product_id=env["product"].id)
    contracts.delete(c.id)
    with pytest.raises(CatalogNotFound):
        contracts.get(c.id)


def test_list_all_ordering(env):
    contracts = env["contracts"]
    pid = env["product"].id
    contracts.create(name="Evergreen", product_id=pid)
    contracts.create(name="Dead", product_id=pid, end_date=TODAY - timedelta(days=5))
    contracts.create(name="Soon", product_id=pid, end_date=TODAY + timedelta(days=10))
    contracts.create(name="Later", product_id=pid, end_date=TODAY + timedelta(days=400))
    names = [c.name for c in contracts.list_all(today=TODAY)]
    assert names == ["Dead", "Soon", "Later", "Evergreen"]
    assert contracts.list_all(today=TODAY)[0].product_name == "Network"


def test_links_and_component_summaries(env):
    contracts, components = env["contracts"], env["components"]
    pid = env["product"].id
    comp = components.create(name="C9300", product_id=pid)
    c = contracts.create(name="SmartNet", product_id=pid,
                         end_date=TODAY - timedelta(days=1))
    got = contracts.link_component(c.id, comp.id)
    assert [m.name for m in got.components] == ["C9300"]
    with pytest.raises(CatalogRuleViolation):
        contracts.link_component(c.id, comp.id)
    with pytest.raises(CatalogRuleViolation):
        contracts.link_component(c.id, 999)
    comp_read = components.get(comp.id, today=TODAY)
    assert [s.name for s in comp_read.contracts] == ["SmartNet"]
    assert comp_read.contracts[0].status == ContractStatus.EXPIRED
    # PATCH response must carry contracts too, same as GET.
    comp_updated = components.update(comp.id, {"description": "x"})
    assert [s.name for s in comp_updated.contracts] == ["SmartNet"]
    got = contracts.unlink_component(c.id, comp.id)
    assert got.components == []
    with pytest.raises(CatalogNotFound):
        contracts.unlink_component(c.id, comp.id)


def test_guards(env):
    contracts, components = env["contracts"], env["components"]
    pid = env["product"].id
    comp = components.create(name="C", product_id=pid)
    c = contracts.create(name="S", product_id=pid)
    contracts.link_component(c.id, comp.id)
    with pytest.raises(CatalogInUse):
        components.delete(comp.id)  # covered by a contract
    with pytest.raises(CatalogInUse):
        env["products"].delete(pid)  # has contracts (and a component)
    contracts.delete(c.id)  # allowed; removes the link row
    components.delete(comp.id)  # now free


def test_component_budget_fields_roundtrip(env):
    components = env["components"]
    comp = components.create(name="C", product_id=env["product"].id,
                             yearly_run_cost=1200.5, replacement_budget=90000)
    assert comp.yearly_run_cost == 1200.5
    updated = components.update(comp.id, {"replacement_budget": None})
    assert updated.replacement_budget is None
    assert updated.yearly_run_cost == 1200.5

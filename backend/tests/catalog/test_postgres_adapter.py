import pytest

from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
)
from app.catalog.domain import (
    CatalogInUse,
    CatalogNotFound,
    CatalogRuleViolation,
    Criticality,
    DependencyType,
    LifecycleState,
)
from app.models import Team


@pytest.fixture()
def repos(db_session):
    return (
        PostgresArtRepository(db_session),
        PostgresProductRepository(db_session),
        PostgresServiceRepository(db_session),
    )


def _seed(repos):
    arts, products, services = repos
    art = arts.create(name="Platform ART")
    product = products.create(name="Network", art_id=art.id)
    return art, product


def test_art_crud_and_duplicate(repos):
    arts, _, _ = repos
    a = arts.create(name="A1", description="d")
    assert arts.get(a.id).name == "A1"
    with pytest.raises(CatalogRuleViolation):
        arts.create(name="A1")
    arts.update(a.id, {"description": None})
    assert arts.get(a.id).description is None
    arts.delete(a.id)
    with pytest.raises(CatalogNotFound):
        arts.get(a.id)


def test_art_delete_blocked_by_product(repos):
    arts, products, _ = repos
    art, _ = _seed(repos)
    with pytest.raises(CatalogInUse):
        arts.delete(art.id)


def test_product_list_enriched(repos, db_session):
    arts, products, services = repos
    art, product = _seed(repos)
    team = Team(name="Net Team")
    db_session.add(team)
    db_session.flush()
    products.update(product.id, {"team_id": team.id})
    services.create(name="Connectivity", product_id=product.id)
    listed = products.list()
    assert listed[0].art_name == "Platform ART"
    assert listed[0].team_name == "Net Team"
    assert listed[0].service_count == 1


def test_product_team_unique(repos, db_session):
    arts, products, _ = repos
    art, product = _seed(repos)
    team = Team(name="Net Team")
    db_session.add(team)
    db_session.flush()
    products.update(product.id, {"team_id": team.id})
    with pytest.raises(CatalogRuleViolation):
        products.create(name="Other", art_id=art.id, team_id=team.id)


def test_product_delete_blocked_by_service(repos):
    _, products, services = repos
    _, product = _seed(repos)
    services.create(name="S", product_id=product.id)
    with pytest.raises(CatalogInUse):
        products.delete(product.id)


def test_service_tree_and_sibling_names(repos):
    _, _, services = repos
    _, product = _seed(repos)
    parent = services.create(name="Connectivity", product_id=product.id)
    services.create(name="Campus", product_id=product.id, parent_service_id=parent.id)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="Campus", product_id=product.id, parent_service_id=parent.id)
    # same name at another level is fine
    services.create(name="Campus", product_id=product.id)
    tree = services.tree(product.id)
    roots = {s.name for s in tree}
    assert roots == {"Connectivity", "Campus"}
    conn = next(s for s in tree if s.name == "Connectivity")
    assert [c.name for c in conn.children] == ["Campus"]


def test_service_parent_rules(repos):
    arts, products, services = repos
    art, product = _seed(repos)
    other = products.create(name="Other", art_id=art.id)
    s1 = services.create(name="S1", product_id=product.id)
    s2 = services.create(name="S2", product_id=other.id)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="X", product_id=product.id, parent_service_id=s2.id)
    # ancestor cycle: s1 -> child c; setting s1.parent = c must fail
    c = services.create(name="C", product_id=product.id, parent_service_id=s1.id)
    with pytest.raises(CatalogRuleViolation):
        services.update(s1.id, {"parent_service_id": c.id})


def test_service_delete_guards(repos):
    _, _, services = repos
    _, product = _seed(repos)
    parent = services.create(name="P", product_id=product.id)
    child = services.create(name="C", product_id=product.id, parent_service_id=parent.id)
    with pytest.raises(CatalogInUse):
        services.delete(parent.id)
    dep_target = services.create(name="T", product_id=product.id)
    services.add_dependency(
        from_service_id=child.id, to_service_id=dep_target.id,
        dep_type=DependencyType.REQUIRES, criticality=Criticality.CRITICAL,
    )
    with pytest.raises(CatalogInUse):
        services.delete(dep_target.id)  # inbound dependency blocks
    services.delete(child.id)  # outbound dependency is removed with the service


def test_dependencies(repos):
    _, _, services = repos
    _, product = _seed(repos)
    a = services.create(name="A", product_id=product.id)
    b = services.create(name="B", product_id=product.id)
    dep = services.add_dependency(
        from_service_id=a.id, to_service_id=b.id,
        dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL, note="n",
    )
    assert dep.to_service_name == "B"
    assert dep.from_product_name == "Network"
    with pytest.raises(CatalogRuleViolation):
        services.add_dependency(
            from_service_id=a.id, to_service_id=b.id,
            dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
        )
    with pytest.raises(CatalogRuleViolation):
        services.add_dependency(
            from_service_id=a.id, to_service_id=a.id,
            dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
        )
    outbound, inbound = services.list_dependencies(a.id)
    assert len(outbound) == 1 and len(inbound) == 0
    _, inbound_b = services.list_dependencies(b.id)
    assert len(inbound_b) == 1
    services.remove_dependency(a.id, dep.id)
    assert services.list_dependencies(a.id) == ([], [])


def test_list_all_carries_product_name(repos):
    _, _, services = repos
    _, product = _seed(repos)
    services.create(name="A", product_id=product.id)
    assert services.list_all()[0].product_name == "Network"

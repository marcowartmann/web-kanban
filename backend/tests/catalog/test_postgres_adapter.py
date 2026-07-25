import pytest
from sqlalchemy import func, select

from app import models as m
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
from app.models import ServiceDependency, Team


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


def test_service_delete_guards(repos, db_session):
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
    assert db_session.scalar(select(func.count()).select_from(ServiceDependency)) == 0


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


def test_product_duplicate_name(repos):
    _, products, _ = repos
    art, product = _seed(repos)  # product.name == "Network"
    with pytest.raises(CatalogRuleViolation):
        products.create(name="Network", art_id=art.id)
    other = products.create(name="Other", art_id=art.id)
    with pytest.raises(CatalogRuleViolation):
        products.update(other.id, {"name": "Network"})


def test_product_art_id_rules(repos):
    _, products, _ = repos
    art, product = _seed(repos)
    with pytest.raises(CatalogRuleViolation):
        products.create(name="X", art_id=99999)
    with pytest.raises(CatalogRuleViolation):
        products.update(product.id, {"art_id": None})
    with pytest.raises(CatalogRuleViolation):
        products.update(product.id, {"art_id": 99999})


def test_product_team_id_rules(repos):
    _, products, _ = repos
    art, product = _seed(repos)
    with pytest.raises(CatalogRuleViolation):
        products.create(name="X", art_id=art.id, team_id=99999)
    with pytest.raises(CatalogRuleViolation):
        products.update(product.id, {"team_id": 99999})


def test_service_unknown_product_id(repos):
    _, _, services = repos
    with pytest.raises(CatalogRuleViolation):
        services.create(name="X", product_id=99999)


def test_service_owner_user_id_rules(repos):
    _, _, services = repos
    _, product = _seed(repos)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="X", product_id=product.id, owner_user_id=99999)
    svc = services.create(name="Y", product_id=product.id)
    with pytest.raises(CatalogRuleViolation):
        services.update(svc.id, {"owner_user_id": 99999})


def test_service_unknown_parent(repos):
    _, _, services = repos
    _, product = _seed(repos)
    with pytest.raises(CatalogRuleViolation):
        services.create(name="X", product_id=product.id, parent_service_id=99999)


def test_add_dependency_unknown_to_service(repos):
    _, _, services = repos
    _, product = _seed(repos)
    a = services.create(name="A", product_id=product.id)
    with pytest.raises(CatalogRuleViolation):
        services.add_dependency(
            from_service_id=a.id, to_service_id=99999,
            dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
        )


def test_remove_dependency_wrong_from_service(repos):
    _, _, services = repos
    _, product = _seed(repos)
    a = services.create(name="A", product_id=product.id)
    b = services.create(name="B", product_id=product.id)
    c = services.create(name="C", product_id=product.id)
    dep = services.add_dependency(
        from_service_id=a.id, to_service_id=b.id,
        dep_type=DependencyType.USES, criticality=Criticality.OPTIONAL,
    )
    with pytest.raises(CatalogNotFound):
        services.remove_dependency(c.id, dep.id)


def test_product_update_refreshes_stale_art_relationship(repos, db_session):
    # Regression: SQLAlchemy does not auto-refresh an already-loaded
    # relationship when its FK column changes underneath it. Holding a live
    # reference to the ORM row -- as any long-lived cache, or a non-refcounting
    # runtime, would -- prevents the "before" get() from being masked by a
    # GC-forced re-SELECT, exposing the staleness for real.
    arts, products, _ = repos
    art1 = arts.create(name="ART One")
    art2 = arts.create(name="ART Two")
    product = products.create(name="Network", art_id=art1.id)

    held_row = db_session.get(m.Product, product.id)
    assert held_row.art.name == "ART One"  # loads + caches the relationship

    products.get(product.id)
    updated = products.update(product.id, {"art_id": art2.id})

    assert updated.art_name == "ART Two"
    assert held_row.art_id == art2.id


def test_service_update_refreshes_stale_owner_relationship(repos, db_session):
    _, _, services = repos
    _, product = _seed(repos)
    user1 = m.User(email="u1@x.com", display_name="User One",
                    password_hash=None, role="member")
    user2 = m.User(email="u2@x.com", display_name="User Two",
                    password_hash=None, role="member")
    db_session.add_all([user1, user2])
    db_session.flush()
    svc = services.create(name="Svc", product_id=product.id, owner_user_id=user1.id)

    held_row = db_session.get(m.Service, svc.id)
    assert held_row.owner.display_name == "User One"  # loads + caches the relationship

    services.get(svc.id)
    updated = services.update(svc.id, {"owner_user_id": user2.id})

    assert updated.owner_name == "User Two"
    assert held_row.owner_user_id == user2.id

from app.catalog.domain import Criticality, DependencyType, LifecycleState
from app.models import Art, Product, Service, ServiceDependency, Team


def test_catalog_models_roundtrip(db_session):
    art = Art(name="Platform ART")
    team = Team(name="Network")
    db_session.add_all([art, team])
    db_session.flush()
    product = Product(name="Network Product", art_id=art.id, team_id=team.id)
    db_session.add(product)
    db_session.flush()
    parent = Service(name="Connectivity", product_id=product.id)
    db_session.add(parent)
    db_session.flush()
    child = Service(
        name="Campus LAN", product_id=product.id,
        parent_service_id=parent.id, lifecycle_state=LifecycleState.ACTIVE,
    )
    db_session.add(child)
    db_session.flush()
    dep = ServiceDependency(
        from_service_id=child.id, to_service_id=parent.id,
        dep_type=DependencyType.REQUIRES, criticality=Criticality.CRITICAL,
    )
    db_session.add(dep)
    db_session.commit()

    assert product.art.name == "Platform ART"
    assert product.team.name == "Network"
    assert child.product.name == "Network Product"
    assert dep.from_service.name == "Campus LAN"
    assert dep.to_service.name == "Connectivity"
    assert parent.lifecycle_state == LifecycleState.PLANNED


def test_enum_columns_persist_values_not_names(db_session):
    from sqlalchemy import text

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="P", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    svc = Service(name="S", product_id=product.id, lifecycle_state=LifecycleState.ACTIVE)
    db_session.add(svc)
    db_session.flush()
    dep_target = Service(name="T", product_id=product.id)
    db_session.add(dep_target)
    db_session.flush()
    dep = ServiceDependency(
        from_service_id=svc.id, to_service_id=dep_target.id,
        dep_type=DependencyType.REQUIRES, criticality=Criticality.CRITICAL,
    )
    db_session.add(dep)
    db_session.commit()
    assert db_session.execute(
        text("SELECT lifecycle_state FROM services WHERE id = :i"), {"i": svc.id}
    ).scalar_one() == "active"
    row = db_session.execute(
        text("SELECT dep_type, criticality FROM service_dependencies WHERE id = :i"), {"i": dep.id}
    ).one()
    assert tuple(row) == ("requires", "critical")

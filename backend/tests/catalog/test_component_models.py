from datetime import date

from app.catalog.domain import LifecycleStage
from app.models import (
    Art,
    Component,
    Product,
    Service,
    System,
    SystemComponent,
    Vendor,
    service_components,
    service_systems,
)


def test_component_system_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    vendor = Vendor(name="Cisco")
    db_session.add_all([product, vendor])
    db_session.flush()
    comp = Component(
        name="Catalyst 9300", model="C9300-48P", product_id=product.id,
        vendor_id=vendor.id, lifecycle_stage=LifecycleStage.OPERATE,
        quantity=120, end_of_support=date(2028, 10, 31),
    )
    system = System(name="Campus fabric", product_id=product.id)
    db_session.add_all([comp, system])
    db_session.flush()
    db_session.add(SystemComponent(system_id=system.id, component_id=comp.id, quantity=80))
    svc = Service(name="Connectivity", product_id=product.id)
    db_session.add(svc)
    db_session.flush()
    db_session.execute(service_components.insert().values(service_id=svc.id, component_id=comp.id))
    db_session.execute(service_systems.insert().values(service_id=svc.id, system_id=system.id))
    db_session.commit()

    assert comp.vendor.name == "Cisco"
    assert comp.product.name == "Network"
    assert system.memberships[0].component.name == "Catalyst 9300"
    assert system.memberships[0].quantity == 80


def test_lifecycle_stage_persists_value(db_session):
    from sqlalchemy import text

    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="P", art_id=art.id)
    db_session.add(product)
    db_session.flush()
    comp = Component(name="X", product_id=product.id, lifecycle_stage=LifecycleStage.PHASE_OUT)
    db_session.add(comp)
    db_session.commit()
    raw = db_session.execute(
        text("SELECT lifecycle_stage FROM components WHERE id = :i"), {"i": comp.id}
    ).scalar_one()
    assert raw == "phase_out"

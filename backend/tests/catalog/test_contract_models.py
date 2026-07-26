from datetime import date

from app.models import Art, Component, Product, SupportContract, Vendor, contract_components


def test_contract_roundtrip(db_session):
    art = Art(name="A")
    db_session.add(art)
    db_session.flush()
    product = Product(name="Network", art_id=art.id)
    vendor = Vendor(name="Cisco")
    db_session.add_all([product, vendor])
    db_session.flush()
    comp = Component(name="C9300", product_id=product.id,
                     yearly_run_cost=1200.5, replacement_budget=90000)
    contract = SupportContract(
        name="SmartNet Campus", product_id=product.id, vendor_id=vendor.id,
        contract_no="SN-1", start_date=date(2026, 1, 1), end_date=date(2027, 1, 1),
        yearly_cost=15000, notice_period_days=60,
    )
    db_session.add_all([comp, contract])
    db_session.flush()
    db_session.execute(contract_components.insert().values(
        contract_id=contract.id, component_id=comp.id))
    db_session.commit()

    assert contract.vendor.name == "Cisco"
    assert contract.product.name == "Network"
    assert float(comp.yearly_run_cost) == 1200.5

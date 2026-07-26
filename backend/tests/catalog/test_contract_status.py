from datetime import date, timedelta

from app.catalog.domain import (
    Component,
    ContractStatus,
    SupportContract,
    contract_status,
)

TODAY = date(2026, 7, 26)


def _status(end=None, notice=None):
    return contract_status(end_date=end, notice_period_days=notice, today=TODAY)


def test_evergreen_is_active():
    assert _status() == ContractStatus.ACTIVE


def test_end_today_or_past_is_expired():
    assert _status(end=TODAY) == ContractStatus.EXPIRED
    assert _status(end=TODAY - timedelta(days=1)) == ContractStatus.EXPIRED


def test_default_notice_window_90_days():
    assert _status(end=TODAY + timedelta(days=90)) == ContractStatus.EXPIRING
    assert _status(end=TODAY + timedelta(days=91)) == ContractStatus.ACTIVE


def test_custom_notice_window():
    assert _status(end=TODAY + timedelta(days=120), notice=180) == ContractStatus.EXPIRING
    assert _status(end=TODAY + timedelta(days=120), notice=30) == ContractStatus.ACTIVE
    assert _status(end=TODAY + timedelta(days=30), notice=30) == ContractStatus.EXPIRING


def test_dataclass_defaults():
    c = SupportContract(id=1, name="SmartNet", product_id=1)
    assert c.status == ContractStatus.ACTIVE
    assert c.components == []
    comp = Component(id=1, name="C", product_id=1)
    assert comp.yearly_run_cost is None
    assert comp.contracts == []

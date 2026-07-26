from datetime import date, timedelta

from app.catalog.domain import (
    Component,
    LifecycleStage,
    RiskLevel,
    component_risk,
    worst_risk,
)

TODAY = date(2026, 7, 26)


def _risk(eos=None, eol=None):
    return component_risk(end_of_support=eos, end_of_life=eol, today=TODAY)


def test_no_dates_is_ok():
    assert _risk() == RiskLevel.OK


def test_far_future_is_ok():
    assert _risk(eos=TODAY + timedelta(days=366)) == RiskLevel.OK


def test_within_365_days_is_warning():
    assert _risk(eos=TODAY + timedelta(days=365)) == RiskLevel.WARNING
    assert _risk(eol=TODAY + timedelta(days=1)) == RiskLevel.WARNING


def test_today_or_past_is_danger():
    assert _risk(eos=TODAY) == RiskLevel.DANGER
    assert _risk(eol=TODAY - timedelta(days=1)) == RiskLevel.DANGER


def test_worst_date_wins():
    assert _risk(eos=TODAY + timedelta(days=400), eol=TODAY - timedelta(days=1)) == RiskLevel.DANGER


def test_worst_risk():
    assert worst_risk([]) == RiskLevel.OK
    assert worst_risk([RiskLevel.OK, RiskLevel.WARNING]) == RiskLevel.WARNING
    assert worst_risk([RiskLevel.WARNING, RiskLevel.DANGER, RiskLevel.OK]) == RiskLevel.DANGER


def test_component_defaults():
    c = Component(id=1, name="C9300", product_id=1)
    assert c.lifecycle_stage == LifecycleStage.PLAN
    assert c.risk == RiskLevel.OK

from app.models import Item, ItemKind
from app.wsjf import recompute


def test_recompute_sets_cod_and_wsjf():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=8, time_criticality=13, risk_reduction=13,
                job_size=1)
    recompute(item)
    assert item.cost_of_delay == 34
    assert item.wsjf_score == 34


def test_recompute_guards_zero_job_size():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=1, time_criticality=2, risk_reduction=3,
                job_size=0)
    recompute(item)
    assert item.cost_of_delay == 6
    assert item.wsjf_score is None  # no divide by zero


def test_recompute_skips_when_components_missing():
    item = Item(kind=ItemKind.FEATURE, title="F", position=0,
                business_value=None, job_size=2, cost_of_delay=99, wsjf_score=42)
    recompute(item)
    assert item.cost_of_delay == 99  # untouched
    assert item.wsjf_score == 42

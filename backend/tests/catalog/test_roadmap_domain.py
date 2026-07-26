from datetime import date

import pytest

from app.catalog.domain import (
    CatalogRuleViolation,
    RoadmapItem,
    RoadmapStatus,
    Stream,
    validate_date_range,
)


def test_validate_date_range_ok_and_equal():
    validate_date_range(date(2026, 1, 1), date(2026, 6, 30))
    validate_date_range(date(2026, 1, 1), date(2026, 1, 1))  # single-day item


def test_validate_date_range_rejects_inverted():
    with pytest.raises(CatalogRuleViolation):
        validate_date_range(date(2026, 6, 30), date(2026, 1, 1))


def test_dataclass_defaults():
    item = RoadmapItem(id=1, title="Wi-Fi 7 rollout", stream_id=1,
                       start_date=date(2026, 1, 1), end_date=date(2026, 6, 30))
    assert item.status == RoadmapStatus.IDEA
    assert item.features == []
    s = Stream(id=1, name="Campus access", product_id=1)
    assert s.position == 0
    assert s.items == []

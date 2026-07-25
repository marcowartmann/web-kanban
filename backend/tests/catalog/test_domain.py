import pytest

from app.catalog.domain import (
    CatalogRuleViolation,
    LifecycleState,
    Service,
    validate_dependency,
    validate_parent,
)


def _svc(id=1, product_id=10, parent=None):
    return Service(id=id, name=f"svc{id}", product_id=product_id, parent_service_id=parent)


def test_validate_parent_accepts_same_product():
    validate_parent(service_id=2, product_id=10, parent=_svc(id=1, product_id=10))


def test_validate_parent_rejects_other_product():
    with pytest.raises(CatalogRuleViolation):
        validate_parent(service_id=2, product_id=10, parent=_svc(id=1, product_id=99))


def test_validate_parent_rejects_self():
    with pytest.raises(CatalogRuleViolation):
        validate_parent(service_id=1, product_id=10, parent=_svc(id=1, product_id=10))


def test_validate_parent_allows_none():
    validate_parent(service_id=1, product_id=10, parent=None)


def test_validate_dependency_rejects_self_loop():
    with pytest.raises(CatalogRuleViolation):
        validate_dependency(5, 5)


def test_service_defaults():
    s = _svc()
    assert s.lifecycle_state == LifecycleState.PLANNED
    assert s.children == []

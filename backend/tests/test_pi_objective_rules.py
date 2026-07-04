import pytest

from app.models import ObjectiveState
from app.pi_objectives import normalize_key_delivery


def test_key_delivery_allowed_only_when_committed():
    assert normalize_key_delivery(ObjectiveState.COMMITTED, True) is True
    assert normalize_key_delivery(ObjectiveState.COMMITTED, False) is False


@pytest.mark.parametrize("state", [ObjectiveState.UNCOMMITTED, ObjectiveState.OUT_OF_SCOPE])
def test_key_delivery_forced_false_when_not_committed(state):
    assert normalize_key_delivery(state, False) is False


@pytest.mark.parametrize("state", [ObjectiveState.UNCOMMITTED, ObjectiveState.OUT_OF_SCOPE])
def test_key_delivery_true_with_noncommitted_raises(state):
    with pytest.raises(ValueError):
        normalize_key_delivery(state, True)

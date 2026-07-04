from app.models import ObjectiveState


def normalize_key_delivery(state: ObjectiveState, is_key_delivery: bool) -> bool:
    """Key Delivery applies only to committed objectives.

    Returns False for any non-committed state. Raises ValueError if the caller
    explicitly asked for key delivery on a non-committed state.
    """
    if state == ObjectiveState.COMMITTED:
        return bool(is_key_delivery)
    if is_key_delivery:
        raise ValueError("Key Delivery is only allowed on committed objectives")
    return False

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import AuditEvent, User

# Every user-editable ItemUpdate field EXCEPT `position` (drag-reorder noise)
# and `wsjf_score` (derived — its inputs are tracked).
ITEM_TRACKED_FIELDS = frozenset(
    {
        "title",
        "description",
        "status",
        "tshirt_size",
        "planning_interval",
        "iteration",
        "leading_team",
        "supporting_team",
        "externer_partner",
        "assignee",
        "kategorie",
        "sdi_prio",
        "akzeptanzkriterien",
        "dependencies",
        "bo_stakeholder",
        "definition_of_done",
        "story_points",
        "business_value",
        "time_criticality",
        "risk_reduction",
        "job_size",
    }
)


def _s(value: object) -> str | None:
    if value is None:
        return None
    # Numeric columns (SQLAlchemy Numeric) round-trip as Decimal, and pydantic
    # coerces JSON ints into floats for float-typed fields (e.g. story_points=5
    # -> 5.0). Whole numbers should read as "5" in the trail, not "5.0" or
    # "5.0000000000" — bool is an int subclass, so it's excluded explicitly.
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        as_float = float(value)
        if as_float.is_integer():
            return str(int(as_float))
        return str(as_float)
    return str(value)


def log_event(
    db: Session,
    *,
    actor: User | None,
    event_type: str,
    entity_type: str,
    entity_id: int | None = None,
    entity_label: str | None = None,
    field: str | None = None,
    old_value: object = None,
    new_value: object = None,
) -> None:
    """Stage one audit row. Never commits — the event rides the caller's commit
    so it is atomic with the mutation it describes."""
    db.add(
        AuditEvent(
            actor_id=actor.id if actor else None,
            actor_name=(actor.display_name[:120] if actor else None),
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=(entity_label[:500] if entity_label else entity_label),
            field=field,
            old_value=_s(old_value),
            new_value=_s(new_value),
        )
    )


def diff_item_changes(
    before: dict, changes: dict
) -> list[tuple[str, str | None, str | None]]:
    """One (field, old, new) per tracked field whose value actually changed."""
    out: list[tuple[str, str | None, str | None]] = []
    for field, new in changes.items():
        if field not in ITEM_TRACKED_FIELDS:
            continue
        old = before.get(field)
        if old != new:
            out.append((field, _s(old), _s(new)))
    return out

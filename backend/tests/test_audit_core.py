from app.audit import ITEM_TRACKED_FIELDS, diff_item_changes, log_event
from app.models import AuditEvent, User


def test_log_event_adds_without_committing(db_session):
    actor = User(email="a@x.ch", display_name="Anna", password_hash=None)
    db_session.add(actor)
    db_session.commit()

    log_event(
        db_session,
        actor=actor,
        event_type="item.created",
        entity_type="item",
        entity_id=7,
        entity_label="My Feature",
    )
    assert len(db_session.new) == 1  # staged, not yet committed
    db_session.commit()
    row = db_session.query(AuditEvent).one()
    assert row.actor_id == actor.id
    assert row.actor_name == "Anna"
    assert row.event_type == "item.created"
    assert row.entity_id == 7
    assert row.created_at is not None


def test_log_event_none_actor_and_stringification(db_session):
    log_event(
        db_session,
        actor=None,
        event_type="auth.login_failed",
        entity_type="auth",
        entity_label="ghost@x.ch",
        field="points",
        old_value=None,
        new_value=3,
    )
    db_session.commit()
    row = db_session.query(AuditEvent).one()
    assert row.actor_id is None and row.actor_name is None
    assert row.old_value is None
    assert row.new_value == "3"


def test_diff_item_changes_tracks_and_skips():
    before = {"status": "Funnel", "position": 1, "wsjf_score": 10.0, "story_points": None}
    changes = {"status": "Ready", "position": 5, "wsjf_score": 20.0, "story_points": 3}
    diffs = diff_item_changes(before, changes)
    assert ("status", "Funnel", "Ready") in diffs
    assert ("story_points", None, "3") in diffs
    assert all(f not in ("position", "wsjf_score") for f, _, _ in diffs)


def test_diff_item_changes_skips_unchanged():
    assert diff_item_changes({"status": "Ready"}, {"status": "Ready"}) == []
    assert "position" not in ITEM_TRACKED_FIELDS
    assert "wsjf_score" not in ITEM_TRACKED_FIELDS
    assert "status" in ITEM_TRACKED_FIELDS


def test_log_event_truncates_oversized_snapshots(db_session):
    log_event(
        db_session,
        actor=None,
        event_type="item.created",
        entity_type="item",
        entity_id=1,
        entity_label="x" * 600,
    )
    db_session.commit()
    row = db_session.query(AuditEvent).one()
    assert len(row.entity_label) == 500

from app.models import PlanningInterval


def test_planning_interval_roundtrip(db_session):
    pi = PlanningInterval(name="PI1-Q3", position=0)
    db_session.add(pi)
    db_session.commit()
    db_session.refresh(pi)
    assert pi.id is not None
    assert pi.created_at is not None
    assert db_session.query(PlanningInterval).count() == 1

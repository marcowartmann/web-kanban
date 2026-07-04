import pytest

from app.models import ObjectiveState, PIObjective, PlanningInterval, Team


@pytest.fixture
def seed_team_and_pi(db_session):
    team = Team(name="Network")
    pi = PlanningInterval(name="PI1-Q3", position=1)
    db_session.add_all([team, pi])
    db_session.commit()
    return team, pi


def test_objective_state_values():
    assert {s.value for s in ObjectiveState} == {"committed", "uncommitted", "out_of_scope"}


def test_objective_defaults(db_session, seed_team_and_pi):
    team, pi = seed_team_and_pi
    obj = PIObjective(team_id=team.id, planning_interval_id=pi.id, title="Ship X")
    db_session.add(obj)
    db_session.commit()
    assert obj.state == ObjectiveState.UNCOMMITTED
    assert obj.is_key_delivery is False
    assert obj.position == 0
    assert obj.team_name == team.name
    assert obj.planning_interval_name == pi.name
    assert obj.feature_ids == []

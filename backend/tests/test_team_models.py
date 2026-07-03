from app.models import Team, User


def test_user_belongs_to_team(db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.flush()
    user = User(display_name="Marco Wartmann", team_id=team.id)
    db_session.add(user)
    db_session.commit()
    assert db_session.get(User, user.id).team.name == "Network"


def test_user_without_team(db_session):
    user = User(display_name="Solo")
    db_session.add(user)
    db_session.commit()
    assert db_session.get(User, user.id).team_id is None

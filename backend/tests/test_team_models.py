from app.models import Team, TeamMember


def test_member_belongs_to_team(db_session):
    team = Team(name="Network")
    db_session.add(team)
    db_session.flush()
    member = TeamMember(name="Marco Wartmann", team_id=team.id)
    db_session.add(member)
    db_session.commit()
    assert db_session.get(TeamMember, member.id).team.name == "Network"


def test_member_without_team(db_session):
    member = TeamMember(name="Solo")
    db_session.add(member)
    db_session.commit()
    assert db_session.get(TeamMember, member.id).team_id is None

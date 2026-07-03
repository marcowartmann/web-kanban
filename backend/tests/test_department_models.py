from app.models import Team, TeamDepartment, User


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def test_department_membership_roundtrip(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    u = User(display_name="U", username="u1")
    db_session.add_all([dep, u])
    db_session.commit()
    dep.members.append(u)
    db_session.commit()
    db_session.refresh(dep)
    db_session.refresh(u)
    assert dep.member_ids == [u.id]
    assert dep.team_name == "Net"
    assert u.department_ids == [dep.id]


def test_deleting_team_cascades_departments(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    db_session.add(dep)
    db_session.commit()
    db_session.delete(net)
    db_session.commit()
    assert db_session.query(TeamDepartment).count() == 0


def test_deleting_user_removes_membership(db_session):
    net = _team(db_session, "Net")
    dep = TeamDepartment(name="Frontend", team_id=net.id)
    u = User(display_name="U", username="u1")
    db_session.add_all([dep, u])
    db_session.commit()
    dep.members.append(u)
    db_session.commit()
    db_session.delete(u)
    db_session.commit()
    db_session.refresh(dep)
    assert dep.member_ids == []

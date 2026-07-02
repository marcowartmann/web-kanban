from app.audit import log_event


def _seed_events(db, n=5, entity_type="item", event_type="item.updated", label="Feature X"):
    for i in range(n):
        log_event(
            db,
            actor=None,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=i + 1,
            entity_label=f"{label} {i}",
        )
    db.commit()


def test_member_gets_403(member_client):
    assert member_client.get("/api/audit").status_code == 403


def test_admin_pagination_and_total(client, db_session):
    _seed_events(db_session, n=7)
    page = client.get("/api/audit?limit=3&offset=0").json()
    assert page["total"] == 7
    assert len(page["items"]) == 3
    # newest first: highest entity_id seeded last comes first
    assert page["items"][0]["entity_id"] == 7
    page2 = client.get("/api/audit?limit=3&offset=6").json()
    assert len(page2["items"]) == 1


def test_q_and_entity_type_filters(client, db_session):
    _seed_events(db_session, n=2, entity_type="item", event_type="item.updated", label="Alpha")
    _seed_events(db_session, n=1, entity_type="auth", event_type="auth.login_failed", label="ghost@x.ch")

    by_type = client.get("/api/audit?entity_type=auth").json()
    assert by_type["total"] == 1
    assert by_type["items"][0]["event_type"] == "auth.login_failed"

    by_q = client.get("/api/audit?q=alpha").json()
    assert by_q["total"] == 2

    by_q_event = client.get("/api/audit?q=login_failed").json()
    assert by_q_event["total"] == 1


def test_limit_clamped(client, db_session):
    _seed_events(db_session, n=1)
    assert client.get("/api/audit?limit=9999").status_code == 200
    assert client.get("/api/audit?limit=0").status_code == 200

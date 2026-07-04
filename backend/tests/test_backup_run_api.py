import app.backup as backup
from app.models import BackupRun


def test_run_now_invokes_backup(client, db_session, monkeypatch):
    def fake_run(db, trigger):
        r = BackupRun(trigger=trigger, status="success", message="ok")
        db.add(r)
        db.commit()
        db.refresh(r)
        return r

    monkeypatch.setattr(backup, "run_backup", fake_run)
    r = client.post("/api/v1/backup/run")
    assert r.status_code == 200
    assert r.json()["status"] == "success" and r.json()["trigger"] == "manual"


def test_runs_list_newest_first(client, db_session):
    for i in range(3):
        db_session.add(BackupRun(trigger="manual", status="success", message=f"r{i}"))
    db_session.commit()
    rows = client.get("/api/v1/backup/runs").json()
    assert len(rows) == 3
    assert rows[0]["id"] > rows[-1]["id"]


def test_test_connection_reports_failure(client, monkeypatch):
    def boom(*a, **k):
        raise OSError("no route to host")

    monkeypatch.setattr(backup, "test_connection", boom)
    r = client.post("/api/v1/backup/test", json={"sftp_host": "nope", "sftp_username": "u"})
    assert r.status_code == 422
    assert "no route to host" in r.json()["detail"]

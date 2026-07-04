def test_get_config_hides_password_and_reports_flag(client):
    r = client.get("/api/v1/backup/config")
    assert r.status_code == 200
    body = r.json()
    assert "sftp_password_enc" not in body and "password" not in body
    assert body["has_password"] is False
    assert body["remote_dir"] == "upload"


def test_put_sets_password_and_fields(client):
    r = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp", "sftp_port": 22, "sftp_username": "kanban",
        "password": "kanban", "remote_dir": "upload", "include_db": True,
        "include_snapshots": False, "schedule_frequency": "daily",
        "schedule_day_of_week": 0, "schedule_time": "03:30", "enabled": True,
    })
    assert r.status_code == 200
    assert r.json()["has_password"] is True
    assert r.json()["include_snapshots"] is False
    # password omitted → unchanged
    r2 = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp2", "sftp_port": 22, "sftp_username": "kanban",
        "remote_dir": "upload", "include_db": True, "include_snapshots": True,
        "schedule_frequency": "disabled", "schedule_day_of_week": 0,
        "schedule_time": "02:00", "enabled": False,
    })
    assert r2.json()["has_password"] is True  # still set
    # clear_password clears it
    r3 = client.put("/api/v1/backup/config", json={
        "sftp_host": "sftp2", "sftp_port": 22, "sftp_username": "kanban",
        "remote_dir": "upload", "include_db": True, "include_snapshots": True,
        "schedule_frequency": "disabled", "schedule_day_of_week": 0,
        "schedule_time": "02:00", "enabled": False, "clear_password": True,
    })
    assert r3.json()["has_password"] is False


def test_config_requires_admin(member_client):
    assert member_client.get("/api/v1/backup/config").status_code == 403

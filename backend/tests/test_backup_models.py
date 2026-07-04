from app.models import BackupConfig, BackupRun


def test_config_defaults(db_session):
    cfg = BackupConfig(id=1)
    db_session.add(cfg)
    db_session.commit()
    assert cfg.sftp_port == 22
    assert cfg.remote_dir == "upload"
    assert cfg.include_db is True
    assert cfg.include_snapshots is True
    assert cfg.schedule_frequency == "disabled"
    assert cfg.enabled is False


def test_run_row(db_session):
    r = BackupRun(trigger="manual", status="success")
    db_session.add(r)
    db_session.commit()
    assert r.id is not None

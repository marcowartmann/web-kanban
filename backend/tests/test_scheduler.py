from app.models import BackupConfig
from app.scheduler import cron_kwargs


def test_daily_cron():
    cfg = BackupConfig(id=1, enabled=True, schedule_frequency="daily", schedule_time="03:30")
    assert cron_kwargs(cfg) == {"hour": 3, "minute": 30}


def test_weekly_cron():
    cfg = BackupConfig(id=1, enabled=True, schedule_frequency="weekly",
                       schedule_day_of_week=2, schedule_time="23:05")
    assert cron_kwargs(cfg) == {"day_of_week": 2, "hour": 23, "minute": 5}


def test_disabled_or_off_returns_none():
    assert cron_kwargs(BackupConfig(id=1, enabled=True, schedule_frequency="disabled")) is None
    assert cron_kwargs(BackupConfig(id=1, enabled=False, schedule_frequency="daily", schedule_time="01:00")) is None

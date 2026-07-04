import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app import backup as backup_svc
from app.db import SessionLocal
from app.models import BackupConfig

_log = logging.getLogger("uvicorn")
_scheduler: AsyncIOScheduler | None = None
_JOB_ID = "backup"


def cron_kwargs(cfg: BackupConfig) -> dict | None:
    if not cfg.enabled or cfg.schedule_frequency == "disabled":
        return None
    hour, minute = (int(x) for x in cfg.schedule_time.split(":"))
    if cfg.schedule_frequency == "weekly":
        return {"day_of_week": cfg.schedule_day_of_week, "hour": hour, "minute": minute}
    return {"hour": hour, "minute": minute}


def _run_scheduled() -> None:
    with SessionLocal() as db:
        run = backup_svc.run_backup(db, trigger="scheduled")
        _log.info("scheduled backup: %s (%s)", run.status, run.message)


def reschedule(db: Session) -> None:
    if _scheduler is None:
        return
    cfg = db.get(BackupConfig, 1)
    _scheduler.remove_all_jobs()
    kwargs = cron_kwargs(cfg) if cfg else None
    if kwargs is not None:
        _scheduler.add_job(_run_scheduled, CronTrigger(timezone="UTC", **kwargs), id=_JOB_ID)
        _log.info("backup scheduled: %s", kwargs)


def start() -> None:
    global _scheduler
    try:
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.start()
        with SessionLocal() as db:
            reschedule(db)
    except Exception as exc:  # never let scheduler setup break app startup
        _log.warning("backup scheduler not started: %s", exc)
        _scheduler = None


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None

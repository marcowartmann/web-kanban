import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import scheduler
from app.auth import ensure_initial_admin, require_user
from app.config import settings
from app.db import SessionLocal, get_db
from app.ldap_settings import ensure_ldap_config
from app.request_logging import RequestLoggingMiddleware, configure_access_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.bootstrap_admin:
        with SessionLocal() as db:
            ensure_initial_admin(db)
            logging.getLogger("uvicorn").info(
                "auth bootstrap: initial admin is %s", settings.initial_admin_email
            )
            # Seed the singleton LDAP config from env on first boot (idempotent;
            # also seeded lazily on first access via get_ldap_config).
            ensure_ldap_config(db)
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title="JAMra API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

configure_access_logging()
app.add_middleware(RequestLoggingMiddleware)

from app.routers import auth, imports, items, boards, teams, capacities, containers, links, planning_intervals, users, audit, comments, features_ranking, departments, pi_objectives, backup, ldap_config

app.include_router(auth.router)
for protected in (
    imports.router,
    items.router,
    boards.router,
    teams.router,
    capacities.router,
    containers.router,
    links.router,
    planning_intervals.router,
    users.router,
    audit.router,
    comments.router,
    features_ranking.router,
    departments.router,
    pi_objectives.router,
    backup.router,
    ldap_config.router,
):
    app.include_router(protected, dependencies=[Depends(require_user)])


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        # Log the real cause instead of swallowing it — otherwise a persistently
        # failing health check gives no clue why (DB auth, DNS, pool state, …).
        logging.getLogger("uvicorn").exception("health check: DB query failed")
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(content={"status": "ok"})

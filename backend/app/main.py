import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import ensure_initial_admin, require_user
from app.config import settings
from app.db import SessionLocal


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.bootstrap_admin:
        with SessionLocal() as db:
            ensure_initial_admin(db)
            logging.getLogger("uvicorn").info(
                "auth bootstrap: initial admin is %s", settings.initial_admin_email
            )
    yield


app = FastAPI(title="SAFe Kanban API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import auth, imports, items, boards, teams, team_members, capacities, links, planning_intervals, users, audit, comments

app.include_router(auth.router)
for protected in (
    imports.router,
    items.router,
    boards.router,
    teams.router,
    team_members.router,
    capacities.router,
    links.router,
    planning_intervals.router,
    users.router,
    audit.router,
    comments.router,
):
    app.include_router(protected, dependencies=[Depends(require_user)])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

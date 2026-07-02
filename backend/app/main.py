from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import require_user
from app.config import settings

app = FastAPI(title="SAFe Kanban API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import auth, imports, items, boards, teams, team_members, capacities, links, planning_intervals, users

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
):
    app.include_router(protected, dependencies=[Depends(require_user)])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

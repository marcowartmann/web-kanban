from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="SAFe Kanban API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import imports, items, boards, teams, team_members, capacities

app.include_router(imports.router)
app.include_router(items.router)
app.include_router(boards.router)
app.include_router(teams.router)
app.include_router(team_members.router)
app.include_router(capacities.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

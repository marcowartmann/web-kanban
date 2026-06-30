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

from app.routers import imports, items

app.include_router(imports.router)
app.include_router(items.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://kanban:kanban@localhost:5432/kanban"
    cors_origins: list[str] = ["http://localhost:5173"]

    session_ttl_days: int = 14
    cookie_secure: bool = False
    bootstrap_admin: bool = False
    initial_admin_email: str = "admin@example.com"
    initial_admin_password: str = "admin"
    initial_admin_name: str = "Admin"


settings = Settings()

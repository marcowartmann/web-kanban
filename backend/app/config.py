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
    initial_admin_username: str = "admin"

    ldap_enabled: bool = False
    ldap_server_uri: str = "ldaps://ldap.internal:636"
    ldap_start_tls: bool = False
    ldap_ca_cert_file: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = "ou=people,dc=example,dc=com"
    ldap_user_filter: str = "(&(objectClass=inetOrgPerson)(uid={uid}))"
    ldap_attr_email: str = "mail"
    ldap_attr_display_name: str = "cn"


settings = Settings()

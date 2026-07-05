"""Runtime LDAP configuration, stored in the DB (singleton ldap_config row).

The DB row is the source of truth. On first boot after upgrade it is seeded from
the LDAP_* env vars (ensure_ldap_config) so existing deployments keep working.
`to_runtime` adapts a row into the attribute shape LdapAuthenticator expects.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt, encrypt
from app.models import LdapConfig


@dataclass(frozen=True)
class LdapRuntimeConfig:
    """The attribute contract LdapAuthenticator reads (ldap_* names)."""
    ldap_server_uri: str
    ldap_start_tls: bool
    ldap_ca_cert_file: str
    ldap_ca_cert_data: str | None
    ldap_bind_dn: str
    ldap_bind_password: str
    ldap_base_dn: str
    ldap_user_filter: str
    ldap_attr_email: str
    ldap_attr_display_name: str


def ensure_ldap_config(db: Session) -> LdapConfig:
    """Create the singleton row from env settings if it does not exist yet."""
    cfg = db.get(LdapConfig, 1)
    if cfg is not None:
        return cfg
    cfg = LdapConfig(
        id=1,
        enabled=settings.ldap_enabled,
        server_uri=settings.ldap_server_uri,
        start_tls=settings.ldap_start_tls,
        ca_cert=None,
        bind_dn=settings.ldap_bind_dn or None,
        bind_password_enc=encrypt(settings.ldap_bind_password) if settings.ldap_bind_password else None,
        base_dn=settings.ldap_base_dn,
        user_filter=settings.ldap_user_filter,
        attr_email=settings.ldap_attr_email,
        attr_display_name=settings.ldap_attr_display_name,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


def get_ldap_config(db: Session) -> LdapConfig:
    return ensure_ldap_config(db)


def to_runtime(cfg: LdapConfig) -> LdapRuntimeConfig:
    return LdapRuntimeConfig(
        ldap_server_uri=cfg.server_uri or "",
        ldap_start_tls=cfg.start_tls,
        ldap_ca_cert_file="",
        ldap_ca_cert_data=cfg.ca_cert or None,
        ldap_bind_dn=cfg.bind_dn or "",
        ldap_bind_password=decrypt(cfg.bind_password_enc) if cfg.bind_password_enc else "",
        ldap_base_dn=cfg.base_dn or "",
        ldap_user_filter=cfg.user_filter or "",
        ldap_attr_email=cfg.attr_email or "mail",
        ldap_attr_display_name=cfg.attr_display_name or "cn",
    )

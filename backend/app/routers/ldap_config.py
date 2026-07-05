from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.crypto import decrypt, encrypt
from app.db import get_db
from app.ldap_auth import LdapAuthenticator
from app.ldap_settings import LdapRuntimeConfig, get_ldap_config
from app.models import LdapConfig, User
from app.schemas import LdapConfigRead, LdapConfigUpdate, LdapTestRequest

router = APIRouter(prefix="/api/v1/ldap", tags=["ldap"],
                   dependencies=[Depends(require_admin)])

_PLAIN_FIELDS = (
    "enabled", "server_uri", "start_tls", "ca_cert", "bind_dn",
    "base_dn", "user_filter", "attr_email", "attr_display_name",
)


def _serialize(cfg: LdapConfig) -> LdapConfigRead:
    read = LdapConfigRead.model_validate(cfg)
    read.has_password = cfg.bind_password_enc is not None
    return read


@router.get("/config", response_model=LdapConfigRead)
def read_config(db: Session = Depends(get_db)) -> LdapConfigRead:
    return _serialize(get_ldap_config(db))


@router.put("/config", response_model=LdapConfigRead)
def update_config(
    payload: LdapConfigUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> LdapConfigRead:
    cfg = get_ldap_config(db)
    for field in _PLAIN_FIELDS:
        setattr(cfg, field, getattr(payload, field))
    if not cfg.ca_cert:  # normalize empty string to NULL
        cfg.ca_cert = None
    if not cfg.bind_dn:
        cfg.bind_dn = None
    if payload.clear_password:
        cfg.bind_password_enc = None
    elif payload.password:
        cfg.bind_password_enc = encrypt(payload.password)
    log_event(db, actor=current, event_type="ldap.config_updated",
              entity_type="ldap", entity_id=1, entity_label="ldap config")
    db.commit()
    db.refresh(cfg)
    return _serialize(cfg)


def _runtime_from(payload: LdapTestRequest, cfg: LdapConfig) -> LdapRuntimeConfig:
    """Merge test-form values over the saved config (blank -> saved)."""
    def pick(value, fallback):
        return value if value not in (None, "") else fallback

    stored_pw = decrypt(cfg.bind_password_enc) if cfg.bind_password_enc else ""
    return LdapRuntimeConfig(
        ldap_server_uri=pick(payload.server_uri, cfg.server_uri) or "",
        ldap_start_tls=payload.start_tls if payload.start_tls is not None else cfg.start_tls,
        ldap_ca_cert_file="",
        ldap_ca_cert_data=pick(payload.ca_cert, cfg.ca_cert) or None,
        ldap_bind_dn=pick(payload.bind_dn, cfg.bind_dn) or "",
        ldap_bind_password=pick(payload.password, stored_pw) or "",
        ldap_base_dn=pick(payload.base_dn, cfg.base_dn) or "",
        ldap_user_filter=pick(payload.user_filter, cfg.user_filter) or "",
        ldap_attr_email=pick(payload.attr_email, cfg.attr_email) or "mail",
        ldap_attr_display_name=pick(payload.attr_display_name, cfg.attr_display_name) or "cn",
    )


def _run_test(runtime: LdapRuntimeConfig, test_username: str | None, test_password: str | None) -> str:
    auth = LdapAuthenticator(runtime)
    if test_username and test_password:
        identity = auth.authenticate(test_username, test_password)
        if identity is None:
            raise ValueError("Bind/search succeeded but the test user could not be authenticated")
        return f"Authenticated '{identity.uid}' ({identity.display_name})"
    # No test user: just verify the service bind + a search of the base DN.
    conn = auth._connect(runtime.ldap_bind_dn or None, runtime.ldap_bind_password or None)
    if not conn.bind():
        raise ValueError("Service bind failed — check server URI, bind DN and password")
    conn.unbind()
    return "Connection and service bind OK"


@router.post("/test")
async def test_connection(
    payload: LdapTestRequest,
    db: Session = Depends(get_db),
) -> dict:
    cfg = get_ldap_config(db)
    runtime = _runtime_from(payload, cfg)
    try:
        message = await run_in_threadpool(
            _run_test, runtime, payload.test_username, payload.test_password
        )
    except Exception as exc:  # surface any bind/TLS/search failure to the UI
        raise HTTPException(status_code=422, detail=f"LDAP test failed: {exc}") from exc
    return {"ok": True, "message": message}

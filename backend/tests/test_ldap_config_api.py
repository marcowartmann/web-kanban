def test_get_config_hides_password_and_reports_flag(client):
    r = client.get("/api/v1/ldap/config")
    assert r.status_code == 200
    body = r.json()
    assert "bind_password_enc" not in body and "password" not in body
    assert body["has_password"] is False
    assert body["enabled"] is False
    assert body["attr_email"] == "mail"


def test_put_sets_fields_and_write_only_password(client):
    r = client.put("/api/v1/ldap/config", json={
        "enabled": True,
        "server_uri": "ldaps://dc.corp.example.com:636",
        "start_tls": False,
        "ca_cert": "-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----",
        "bind_dn": "svc@corp.example.com",
        "password": "secret",
        "base_dn": "DC=corp,DC=example,DC=com",
        "user_filter": "(&(objectCategory=person)(objectClass=user)(sAMAccountName={uid}))",
        "attr_email": "mail",
        "attr_display_name": "displayName",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["has_password"] is True
    assert body["attr_display_name"] == "displayName"
    assert body["ca_cert"].startswith("-----BEGIN CERTIFICATE-----")

    # password omitted on a later update → unchanged
    r2 = client.put("/api/v1/ldap/config", json={
        "enabled": True, "server_uri": "ldaps://dc.corp.example.com:636",
        "start_tls": False, "bind_dn": "svc@corp.example.com",
        "base_dn": "DC=corp,DC=example,DC=com",
        "user_filter": "(sAMAccountName={uid})", "attr_email": "mail",
        "attr_display_name": "displayName",
    })
    assert r2.json()["has_password"] is True

    # clear_password removes it
    r3 = client.put("/api/v1/ldap/config", json={
        "enabled": False, "server_uri": "ldaps://dc.corp.example.com:636",
        "start_tls": False, "base_dn": "DC=corp,DC=example,DC=com",
        "user_filter": "(sAMAccountName={uid})", "attr_email": "mail",
        "attr_display_name": "displayName", "clear_password": True,
    })
    assert r3.json()["has_password"] is False


def test_config_drives_auth_config_flag(client):
    assert client.get("/api/v1/auth/config").json()["ldap_enabled"] is False
    client.put("/api/v1/ldap/config", json={
        "enabled": True, "server_uri": "ldaps://x", "start_tls": False,
        "base_dn": "dc=x", "user_filter": "(uid={uid})",
        "attr_email": "mail", "attr_display_name": "cn",
    })
    assert client.get("/api/v1/auth/config").json()["ldap_enabled"] is True


def test_config_requires_admin(member_client):
    assert member_client.get("/api/v1/ldap/config").status_code == 403
    assert member_client.put("/api/v1/ldap/config", json={}).status_code == 403


def test_runtime_config_decrypts_password_and_carries_ca(client, db_session):
    from app.ldap_settings import get_ldap_config, to_runtime

    client.put("/api/v1/ldap/config", json={
        "enabled": True, "server_uri": "ldaps://dc", "start_tls": False,
        "ca_cert": "PEMDATA", "bind_dn": "svc", "password": "topsecret",
        "base_dn": "dc=x", "user_filter": "(uid={uid})",
        "attr_email": "mail", "attr_display_name": "cn",
    })
    db_session.expire_all()
    runtime = to_runtime(get_ldap_config(db_session))
    assert runtime.ldap_bind_password == "topsecret"      # decrypted
    assert runtime.ldap_ca_cert_data == "PEMDATA"
    assert runtime.ldap_bind_dn == "svc"

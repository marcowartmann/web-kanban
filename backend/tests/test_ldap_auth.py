import ldap3

from app.config import Settings
from app.ldap_auth import LdapAuthenticator, LdapIdentity

DIRECTORY = {
    "cn=reader,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "reader", "userPassword": "readerpw",
    },
    "uid=jdoe,ou=people,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "Doe", "uid": "jdoe",
        "mail": "jdoe@ex.com", "cn": "John Doe", "userPassword": "s3cret",
    },
    "uid=dupe,ou=people,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "One", "uid": "dupe",
        "mail": "one@ex.com", "cn": "One", "userPassword": "pw",
    },
    "uid=dupe,ou=other,dc=ex,dc=com": {
        "objectClass": ["inetOrgPerson"], "sn": "Two", "uid": "dupe",
        "mail": "two@ex.com", "cn": "Two", "userPassword": "pw",
    },
}


def _mock_factory():
    def factory(user, password):
        server = ldap3.Server("mock")
        conn = ldap3.Connection(
            server, user=user, password=password, client_strategy=ldap3.MOCK_SYNC,
        )
        for dn, attrs in DIRECTORY.items():
            conn.strategy.add_entry(dn, attrs)
        return conn
    return factory


def _auth():
    s = Settings(
        ldap_enabled=True,
        ldap_bind_dn="cn=reader,dc=ex,dc=com",
        ldap_bind_password="readerpw",
        ldap_base_dn="dc=ex,dc=com",
    )
    return LdapAuthenticator(s, connection_factory=_mock_factory())


def test_valid_credentials_return_identity():
    ident = _auth().authenticate("jdoe", "s3cret")
    assert ident == LdapIdentity(uid="jdoe", email="jdoe@ex.com", display_name="John Doe")


def test_wrong_password_returns_none():
    assert _auth().authenticate("jdoe", "nope") is None


def test_empty_password_returns_none():
    assert _auth().authenticate("jdoe", "") is None


def test_unknown_uid_returns_none():
    assert _auth().authenticate("ghost", "s3cret") is None


def test_multiple_matches_return_none():
    assert _auth().authenticate("dupe", "pw") is None

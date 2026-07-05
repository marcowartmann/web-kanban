from dataclasses import dataclass

import ldap3
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from app.config import settings


@dataclass(frozen=True)
class LdapIdentity:
    uid: str
    email: str | None
    display_name: str


class LdapAuthenticator:
    def __init__(self, config, connection_factory=None):
        self._c = config
        self._connect = connection_factory or self._real_connection

    def _real_connection(self, user, password):
        server = ldap3.Server(
            self._c.ldap_server_uri,
            use_ssl=not self._c.ldap_start_tls,
            tls=ldap3.Tls(ca_certs_file=self._c.ldap_ca_cert_file or None),
        )
        # auto_referrals=False: Active Directory returns referral entries on
        # searches under the domain root; chasing them makes the search return
        # 0/other entries and breaks auth. Disabling it is required for AD and
        # harmless for OpenLDAP.
        conn = ldap3.Connection(
            server, user=user or None, password=password or None, auto_referrals=False
        )
        if self._c.ldap_start_tls:
            conn.start_tls()
        return conn

    def authenticate(self, uid: str, password: str) -> LdapIdentity | None:
        # Empty password would be an anonymous bind on many servers: reject early.
        if not uid or not password:
            return None
        try:
            svc = self._connect(self._c.ldap_bind_dn, self._c.ldap_bind_password)
            if not svc.bind():
                return None
            flt = self._c.ldap_user_filter.replace("{uid}", escape_filter_chars(uid))
            svc.search(
                self._c.ldap_base_dn,
                flt,
                attributes=[self._c.ldap_attr_email, self._c.ldap_attr_display_name],
            )
            if len(svc.entries) != 1:
                return None
            entry = svc.entries[0]
            user_conn = self._connect(entry.entry_dn, password)
            if not user_conn.bind():
                return None
            email = self._attr(entry, self._c.ldap_attr_email)
            display = self._attr(entry, self._c.ldap_attr_display_name) or uid
            return LdapIdentity(uid=uid, email=email, display_name=display)
        except LDAPException:
            return None

    @staticmethod
    def _attr(entry, name: str) -> str | None:
        try:
            value = entry[name].value
        except (LDAPException, KeyError):
            return None
        return str(value) if value else None


def get_authenticator() -> LdapAuthenticator:
    return LdapAuthenticator(settings)

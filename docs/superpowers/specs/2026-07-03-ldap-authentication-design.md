# LDAP Authentication — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Let users authenticate against the organization's existing **OpenLDAP** directory,
while keeping **local** database accounts as a fallback. The login page defaults to
LDAP; a user may explicitly choose Local. Scope is **authentication only** — no
group→role mapping, no MFA, no cross-app SSO.

## Decision: direct LDAP bind (not OIDC/Authentik)

FastAPI binds to the directory directly rather than federating through an OIDC
provider (Authentik). Rationale for this project's constraints:

- OpenLDAP has **no native OIDC** — going OIDC would require standing up and
  operating Authentik (its own Postgres + Redis + upgrades), i.e. another
  stateful service. The stated ops appetite is "keep it minimal."
- Scope is **just authentication**. Group→role mapping, MFA, and cross-app SSO —
  the things Authentik would earn its keep on — are explicitly out of scope, so
  its benefits would go unused.
- The existing schema already has the seams: `auth_provider` (`'local'` today,
  `'ldap'` now, `'oidc'` still possible later), nullable `password_hash`, and
  `verify_password()` already rejecting accounts with no local password. OIDC can
  still slot in later without rework if Authentik is ever adopted.

The one real downside of direct bind — the app handles the user's plaintext
password on login — is mitigated: it is an internal tool, LDAPS/StartTLS protects
transit, and the password is bind-and-discard (never persisted, never logged).

## Login identifier & schema change

Users log in by **`uid`** (not email). The `uid` must be persisted to route an
existing user to the correct auth backend and to enforce uniqueness.

- Add `username VARCHAR(150) UNIQUE` to `users` (nullable at the column level;
  required in practice for any login-capable account).
- **LDAP rows:** `username = uid`, `email = mail` (synced from the directory),
  `password_hash = NULL`, `auth_provider = "ldap"`.
- **Local rows:** `username` set by an admin. The seeded bootstrap admin gets its
  username from a new `initial_admin_username` config key.
- `email` remains on the row as a data attribute and stays the join key for
  assignees/comments — unchanged.

**Migration (Alembic):**
- Add the column and unique index.
- Backfill existing local rows' `username` from the email local-part (segment
  before `@`). If two rows would collide under the unique index (e.g.
  `a@x.com` and `a@y.com` both → `a`), suffix later ones with their row id
  (`a`, `a-2`, …). Rows with no email fall back to `user-<id>`.
- Must be dry-run **upgrade and downgrade** against the compose Postgres before
  acceptance (project rule for migrations).

## §1 — Login form, routing & local fallback

**Login page:** `username` + `password` form with a segmented method toggle
**[LDAP] [Local]**, defaulting to **LDAP**. When `ldap_enabled` is false, the
toggle is hidden and the form is local-only. The chosen method is sent to the API.

**`POST /api/v1/auth/login`** accepts `{ username, password, method }` and routes
explicitly:

- **`method = "local"`** → find `User` by `username` where
  `auth_provider = "local"` → bcrypt verify (existing path). Fallback path; the
  bootstrap admin is exactly this. Works even when LDAP is unreachable.
- **`method = "ldap"`** → LDAP search-then-bind by `uid`. On success, find-or-
  provision the `User` by `username` where `auth_provider = "ldap"`, syncing
  `display_name` and `email` from the directory, then mint the normal session
  cookie.
- Any failure → the existing uniform `401 Invalid credentials` plus the existing
  `auth.login_failed` audit event. Local/LDAP failures are indistinguishable to
  the caller.

**Auto-provisioning:** the first successful LDAP bind for an unknown `uid` creates
a `User(auth_provider="ldap", role="member", is_active=True, …)`. Roles are
promoted afterward in the existing users-admin UI.

**Collision guard:** `username` is globally unique — one username maps to exactly
one account of one provider. If a login resolves to a username that exists under
the *other* provider (e.g. `method="ldap"` but the row is `auth_provider="local"`),
reject with `401` rather than binding across providers.

**Unchanged:** session creation, the `kanban_session` cookie, sliding-TTL renewal,
`Authorization: Bearer` support, logout, `GET /me`, and the audit events all stay
as they are. Local password change (`PATCH /me/password`) remains local-only and
is inapplicable to LDAP accounts (they have no `password_hash`).

## §2 — LDAP client

New isolated module `backend/app/ldap_auth.py` exposing one public method:

```python
def authenticate(uid: str, password: str) -> LdapIdentity | None
```

`LdapIdentity` is a dataclass: `uid`, `email`, `display_name`. Returns `None` on
**any** failure (bad credentials, not found, multiple matches, connection error) —
the router never distinguishes them, preserving the uniform `401`.

**Library:** `ldap3` (pure-Python; no `libldap`/C build deps, keeping the Docker
image clean; ships an offline mock server used in tests).

**Search-then-bind:**
1. Connect to `ldap_server_uri` over LDAPS (or StartTLS if configured). Connection
   failure → `None`.
2. Bind as the read-only service account (`ldap_bind_dn` / `ldap_bind_password`),
   or anonymously if both are empty.
3. Search `ldap_base_dn` with `ldap_user_filter` (`{uid}` escaped-substituted),
   retrieving the email and display-name attributes. Zero or >1 results → `None`.
4. Rebind as the found DN with the supplied `password`. Success → build
   `LdapIdentity`; failure → `None`.

The plaintext password exists only in the bind call's local scope; it is never
logged or persisted.

## §3 — Config keys

Added to `Settings` (env-overridable; feature **off by default** so existing dev
and tests are unaffected):

| Key | Example | Purpose |
|---|---|---|
| `ldap_enabled` | `false` | Master switch; off → login page hides the LDAP toggle. |
| `ldap_server_uri` | `ldaps://ldap.internal:636` | Directory endpoint. |
| `ldap_start_tls` | `false` | Use StartTLS on an `ldap://` URI instead of LDAPS. |
| `ldap_ca_cert_file` | `` | Optional CA bundle for TLS verification. |
| `ldap_bind_dn` | `cn=reader,dc=ex,dc=com` | Service account for search; empty = anonymous. |
| `ldap_bind_password` | `` | Service account password. |
| `ldap_base_dn` | `ou=people,dc=ex,dc=com` | Search base. |
| `ldap_user_filter` | `(&(objectClass=inetOrgPerson)(uid={uid}))` | User lookup filter; `{uid}` is escaped-substituted. |
| `ldap_attr_email` | `mail` | Email attribute mapping. |
| `ldap_attr_display_name` | `cn` | Display-name attribute mapping. |
| `initial_admin_username` | `admin` | Username for the seeded local admin. |

`.env.example` gains these keys with safe defaults and a comment block.

## §4 — Testing

- **Router unit tests** (fake authenticator injected, no network): local-hit,
  ldap-hit-existing, ldap-hit-provisions-new-user, wrong-method, cross-provider
  collision, inactive user, uniform-401.
- **LDAP client tests:** `ldap3` offline **mock server** (in-memory LDIF) covering
  found / not-found / wrong-password / multiple-match, exercising the real
  search-then-bind wiring without a live directory.
- **Migration test:** upgrade **and** downgrade against compose Postgres; assert
  the `username` backfill and the unique constraint.
- **No OpenLDAP container** in docker-compose — an OpenLDAP is already deployed for
  real end-to-end verification, and the mock server covers CI.

## Out of scope

- OIDC / Authentik federation (design keeps the seam open for later).
- Group→role mapping, MFA, cross-app SSO.
- Rate limiting / lockout on login attempts (pre-existing gap, unchanged).
- LDAP-side password changes (LDAP accounts have no local password to change).

## Files touched (anticipated)

- `backend/app/models.py` — `User.username` column.
- `backend/alembic/versions/*` — add-column + backfill migration.
- `backend/app/ldap_auth.py` — new `LdapAuthenticator` / `LdapIdentity`.
- `backend/app/config.py` — LDAP + `initial_admin_username` settings.
- `backend/app/routers/auth.py` — method-routed login.
- `backend/app/schemas.py` — `LoginRequest` gains `username` + `method`.
- `backend/app/auth.py` — `ensure_initial_admin` sets `username`; LDAP provisioning helper.
- `frontend/src/auth/*` — username field + LDAP/Local toggle.
- `.env.example` — LDAP config block.
- Tests as per §4.

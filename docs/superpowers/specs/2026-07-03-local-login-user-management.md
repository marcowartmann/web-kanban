# Local Login for Admin-Created Users — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Let admins create and edit **local** user accounts that can sign in via the
Local login method. Today `create_user` accepts a password but never sets a
`username`, and local login matches on `username` — so such accounts can hold a
password yet never authenticate. This closes that gap.

Builds on [2026-07-03-ldap-authentication-design.md]: the `username` column,
method-routed login, and the cross-provider collision guard already exist.

## Credential model

A login-capable local account = **username + password**. Email is optional and
fully decoupled from the password.

- `username` is the login identifier (matches how LDAP login works by `uid`).
- `password` requires a `username` (previously it required an email).
- `email` is optional metadata; it may be present or cleared regardless of
  whether the account can log in.
- `auth_provider` stays `"local"` (the model default) for these accounts.

## Backend

### Schemas (`app/schemas.py`)
- `UserCreate`: add `username: str | None = Field(default=None, min_length=1, max_length=150)`.
- `UserUpdate`: add `username: str | None = None`.
- `UserRead`: add `username: str | None = None` so the admin UI can display/edit it.

### `create_user` (`app/routers/users.py`)
- Normalize: `username = (payload.username or "").strip() or None`.
- Replace the guard `password requires email` with **`password requires username`**
  → `422 "Password requires a username"` when `payload.password` is set but
  `username` is `None`.
- If `username` is set and already taken (case-sensitive exact match on
  `User.username`), return `409 "Username already in use"`.
- Set `username` on the new `User`.
- Existing email-uniqueness and team checks are unchanged.

### `update_user` (`app/routers/users.py`)
- Accept `username` in the change set. Normalize empty/whitespace → `None`.
- If setting a non-null `username` that collides with another user, `409 "Username already in use"`.
- Guard: if the result would leave `password_hash` set with `username is None`
  (i.e. clearing the username off a password account), reject
  `422 "Remove the password first"`.
- **Relax the existing email guard:** email may now be cleared even when a
  password is set (the password is tied to `username`, not email). Remove the
  `password_hash is not None -> "Remove the password first"` branch on email
  clearing.
- Audit `username` changes alongside the other tracked fields
  (old → new, same redaction/format as `email`).

## Frontend

### Types (`src/types.ts`)
- Add `username?: string | null` to `AuthUser`.

### `UserModal` (`src/components/admin/UserModal.tsx`)
- Add a **Username** text field (create + edit), seeded from `user?.username`.
- Validation:
  - `usernameOk`: required (non-empty) whenever a password is entered.
  - `passwordOk`: `password === "" || (password.length >= 8 && username.trim() !== "")`
    (username replaces email in this rule).
  - `valid` includes `usernameOk`.
- Move the "needed to log in" hint from the Email field to the Username field;
  Email placeholder becomes "Optional".
- Create payload includes `username` (empty → `null`).
- Edit diff: include `username` when changed (empty → `null`).

### Users list (`src/components/admin/UsersSection.tsx` or equivalent)
- Show the `username` (login id) in the row if a suitable column exists; if it
  requires layout surgery, skip — the modal is the source of truth. (YAGNI:
  display only, no new behavior.)

## Interaction with LDAP

`username` is globally unique, so this composes with the existing login collision
guard: an admin cannot claim a username already used by any account (local or
LDAP) — blocked at `409` — and an LDAP `uid` that matches a local username is
rejected at login. No new logic needed.

## Testing

### Backend (`tests/test_api_users.py`)
- Create with `username` + `password` → the user can `POST /auth/login`
  `{username, password, method: "local"}` and get `200`.
- Create with `password` but no `username` → `422`.
- Create with a `username` already in use → `409`.
- Edit an existing password-less user to add `username` + `password` → login works.
- Edit clearing `username` while `password_hash` is set → `422`.
- Edit clearing `email` while a password is set → succeeds (relaxed guard).

### Frontend (`src/components/admin/UserModal.test.tsx`)
- Renders a Username field in create mode.
- Entering a password without a username keeps Save disabled; adding a username enables it.
- Create submits `username` in the payload.

## Out of scope

- No migration (the `username` column already exists).
- No change to LDAP provisioning or the login router.
- No self-service username change (`PATCH /me` remains password-only).

## Files touched

- `backend/app/schemas.py`
- `backend/app/routers/users.py`
- `backend/tests/test_api_users.py`
- `frontend/src/types.ts`
- `frontend/src/components/admin/UserModal.tsx`
- `frontend/src/components/admin/UserModal.test.tsx`
- (optional) `frontend/src/components/admin/UsersSection.tsx`

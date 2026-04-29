# Contract: Auth API

**Feature**: 002-user-auth-and-kiwoom-market-data
**Base path**: `/api/auth`
**Auth**: All endpoints below are public except `GET /me`, which requires a valid session cookie.
**Cookies**: All endpoints set/clear a session cookie named `ib.sid` (httpOnly, SameSite=Lax, Secure in production, signed with `SESSION_SECRET`).

All requests/responses are `application/json; charset=utf-8`. Error responses always have shape `{ "error": "<korean user-facing message>" }` and a 4xx/5xx status. The backend never returns a stack trace.

---

## POST `/api/auth/register`

Create a new account and start a session.

**Request body**:
```json
{
  "email": "user@example.com",
  "password": "at-least-8-chars"
}
```

**Validation**:
- `email`: required, trimmed, lowercased, basic email regex; collision check is case-insensitive.
- `password`: required, ≥ 8 characters.

**Responses**:

| Status | Body | When |
|---|---|---|
| `201 Created` | `{ "user": { "id": 12, "email": "user@example.com" } }` + `Set-Cookie: ib.sid=…` | Account created, session started |
| `400 Bad Request` | `{ "error": "이메일 형식이 올바르지 않습니다." }` | Email regex fail |
| `400 Bad Request` | `{ "error": "비밀번호는 최소 8자 이상이어야 합니다." }` | Short password |
| `409 Conflict` | `{ "error": "이미 가입된 이메일입니다." }` | Email already taken |

**Side effects**: writes to `users`. Logs `{event: "auth.register", userId, email}` (no password).

---

## POST `/api/auth/login`

Sign in to an existing account.

**Request body**:
```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "user": { "id": 12, "email": "user@example.com" } }` + `Set-Cookie: ib.sid=…` | Credentials valid |
| `401 Unauthorized` | `{ "error": "이메일 또는 비밀번호가 올바르지 않습니다." }` | Wrong password OR unknown email — same response, by design (FR-008) |

**Side effects**: starts a session row in `data/sessions.db`. Logs `{event: "auth.login", userId}` on success; `{event: "auth.login.failed", emailHash}` on failure (NEVER the raw email or password).

---

## POST `/api/auth/logout`

End the current session.

**Request body**: empty.

**Responses**:

| Status | Body | When |
|---|---|---|
| `204 No Content` | (empty) + `Set-Cookie: ib.sid=; Max-Age=0` | Always — logout is idempotent |

**Side effects**: deletes the session row.

---

## GET `/api/auth/me`

Return the currently signed-in user.

**Auth**: requires session cookie.

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "user": { "id": 12, "email": "user@example.com" } }` | Signed in |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session / expired |

The frontend calls this on app boot to populate `AuthContext`.

---

## Cross-cutting

- The session cookie is the **only** auth carrier. No `Authorization: Bearer` headers are accepted by these or any other backend route.
- A request whose session cookie is valid but whose user row was deleted MUST be treated as 401 (the next request after deletion clears the session).

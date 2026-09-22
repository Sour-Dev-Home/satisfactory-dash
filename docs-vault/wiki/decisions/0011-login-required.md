# ADR-0011: Login required (single operator now)

Status: accepted (the project owner), 2026-09-22

## Context

A user's dedicated server can hold private things (save name, player activity, admin
actions like the auto-pause toggle). The repo and frontend are public (DEPLOYMENT.md), so the API
must not be. Today server.ts:21 applies cors() with no origin restriction.

## Decision

Every /api route except GET /api/health needs an authenticated session; otherwise 401
unauthorized. v1 = one operator from config: DASHBOARD_ADMIN_USER, DASHBOARD_ADMIN_PASSWORD_HASH
(node:crypto scrypt, no native modules), SESSION_SECRET. These are validated at startup, and
startup fails fast in production if any is missing. The session is a signed, expiring, httpOnly,
Secure, SameSite=Lax cookie. Endpoints: POST /api/auth/login, POST /api/auth/logout,
GET /api/auth/session. Mutations accept JSON only. CORS allows only the configured frontend
origin, with credentials (this replaces cors() at server.ts:21). Login is rate-limited in-process
per IP (429 rate_limited), and failed attempts are logged without the password. Code sits behind
an Authenticator interface (services/auth/), with the middleware in routes/.
Deploy constraint: frontend and API on the same site (one registrable domain, or the API proxied
under the Pages domain). Auth ships before the backend is reachable from outside the machine.

## Consequences

The frontend needs a login screen and treats 401 as "go to login". No 403 yet:
with one operator, authenticated = allowed.

## Revisit when

A second person needs their own login or servers. That is multi-tenant state:
ADR-0009 fires (users + server ownership in Postgres, or a managed IdP such as Cognito; the project
owner decides). Add roles and 403 when view-only users exist.

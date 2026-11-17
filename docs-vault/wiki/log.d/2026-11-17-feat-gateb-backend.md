- **Gate B PR 3: the backend has no password login** (owner, 2026-11-17, #186; ADR-0025 PR 9).
  - `POST /api/auth/login` is gone (an unknown route now), and `signInMethods` never lists "password": it is
    `["google"]` (+ `google_signup`), or `[]` without Google.
  - The password and stateless-session code is deleted: `passwordHash.ts`, the authenticator, the password rate
    limiter, `statelessSessionStore.ts`, `sessionDenylist.ts`, `sessionToken.ts` (`SESSION_TTL_SECONDS` moved to
    `sessionStore.ts`), and `scripts/hash-password.ts`. `OPERATOR_SUBJECT` lives in `operatorSubject.ts`.
  - `DASHBOARD_ADMIN_PASSWORD_HASH` and `SESSION_SECRET` are no longer read. `DASHBOARD_ADMIN_USER` is optional, the
    operator's display name (default "operator").
  - Without a database the backend still boots and serves health, but nobody can sign in (`noSessionStore.ts`).
  - The `local` / `operator` identity stays as the operator's anchor but no longer reports as an auth method.
  - The sign-in page shows the password form only when the server offers it, and says "Sign-in isn't available on
    this server." when it offers nothing. The contract (`LoginRequestSchema`, `endpoints.auth.login`, the "password"
    values) is untouched until this backend is in production.
  - CI (`ci.yml`, `compose.yml`, `image.yml`), `compose.yaml` and both `.env.example` files no longer generate or
    require a password hash or session secret.

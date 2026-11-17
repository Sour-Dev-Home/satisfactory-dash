- **Gate B PR 4: password login leaves the contract and the frontend** (owner, 2026-11-17, #186; ADR-0025 PR 9).
  - `packages/shared`: `LoginRequestSchema`, the `LoginRequest` type and `endpoints.auth.login` are deleted. The
    session descriptions name Google only (`signInMethods` e.g. `["google"]` or `["google", "google_signup"]`, still a
    plain optional string array), and the session cookie is described as a database session. The
    `loginRequestValid` and `errorLoginFailed` fixtures are gone.
  - Sign-in card (`LoginForm.tsx`): the username/password form, its mutation and the "or" divider are gone, and
    `LOGIN_MUTATION_KEY` with them, so every mutation's 401 now signs out. It shows the Google button (and the terms
    steps) when Google is offered, otherwise "Sign-in isn't available on this server.", which now includes a backend
    that sends no `signInMethods` at all.
  - Delete account: `REAUTH_PASSWORD` is `REAUTH_SIGN_OUT_AND_IN`, the generic fallback for an account without Google.
  - Mocks and e2e: the login handler and the `login-failed` / `login-rate-limited` scenarios (and their baselines) are
    gone. `login` now offers Google with sign-up open, and a new `login-unavailable` state covers "not available".
  - Backend tests keep proving `POST /api/auth/login` stays gone, with the literal path.

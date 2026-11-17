- **Gate B PR 2: nothing signs in with a password any more** (owner, 2026-11-17, #186).
  - The deploy's staging check (`scripts/deploy/deploy.mjs` `staging`) no longer signs in as `staging-admin`. It checks
    the signed-out side of auth: `GET /api/auth/session` answers `authenticated: false`, and `GET /api/servers`
    answers 401 with the `unauthorized` error envelope. `deploy.yml` no longer passes `STAGING_ADMIN_PASSWORD`. The
    secret and the staging `DASHBOARD_ADMIN_*` SSM values go in the infra cleanup PR.
  - The demo's "Enter demo" calls `enterDemo()` (`frontend/src/demo/session.ts`, a module with no imports, so
    AuthGate's static import of DemoEntry pulls in nothing else) instead of `POST /api/auth/login`. The demo no longer
    answers that route. The demo tests sign in the same way.

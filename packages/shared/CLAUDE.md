# packages/shared/

See the root `CLAUDE.md` for project-wide rules. This package is the contract seam
between `frontend/` and `backend/` — the one place both future agents must coordinate
through rather than around.

**Rule:** a change here is a breaking-change candidate for two other modules. Never
land a change to this package in the same turn as unrelated frontend or backend work —
keep contract changes isolated and update every caller in both `frontend/` and
`backend/` as part of the same change.

Source-only, no build step: both `frontend` (Vite) and `backend` (esbuild/tsx) consume
the `.ts` files directly via bundler-style module resolution.

# @satisfactory-dash/shared

TypeScript types shared between `frontend/` and `backend/` — the API contract between
them. Source-only (no build step); both sides consume the `.ts` files directly since
`frontend` (Vite) and `backend` (esbuild/tsx) both use bundler-style module resolution.

**Rule:** any change here is a contract change. If you edit a type in this package,
update every caller in both `frontend/` and `backend/` in the same change — don't let
one side drift from the other.

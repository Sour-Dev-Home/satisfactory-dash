# @satisfactory-dash/shared

The API contract between `frontend/` and `backend/`, as zod schemas (ADR-0002 in
`docs-vault/wiki/decisions/`). Types come from `z.infer`, so the runtime check and the
type can't drift apart. Source-only (no build step); both sides consume the `.ts` files
directly since `frontend` (Vite) and `backend` (esbuild/tsx) both use bundler-style
module resolution.

**Rule:** any change here is a contract change. If you edit a schema in this package,
update every caller in both `frontend/` and `backend/` in the same change — don't let
one side drift from the other. Adding a field is non-breaking; renaming, removing or
retyping one is breaking (ADR-0007).

## Layout

- `src/` — the schemas: `envelope.ts` (the `{ serverId, observedAt, stale, data }`
  snapshot wrapper), `errors.ts` (error envelope and `KnownErrorCode`), one file per
  resource (`health`, `servers`, `status`, `factory`, `power`, `auth`, `settings`), and `endpoints.ts`
  mapping each route to its path builder and response schema. Every field's unit and
  range is in its `.describe()` text (ADR-0006).
- `src/browser.ts` — exported as `@satisfactory-dash/shared/browser`: sets zod's `jitless`
  option so a strict CSP (no `unsafe-eval`) sees no `securitypolicyviolation` from zod's
  runtime-compilation probe. The frontend imports it first in its entry point; the backend
  must never import it.
- `fixtures/` — example responses built from real 2026-09-22 captures, exported as
  `@satisfactory-dash/shared/fixtures`. For tests and mock servers only; production code
  must never import them.
- `test/fixtures.test.ts` — every exported fixture (responses and request bodies) must parse against its schema and
  round-trip unchanged. A fixture with no matching schema fails the test.

`npm run test -w packages/shared` (also part of the root `npm run test`).

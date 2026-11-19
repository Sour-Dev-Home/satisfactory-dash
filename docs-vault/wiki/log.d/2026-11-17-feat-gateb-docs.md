- **Gate B PR 6: the docs say sign-in is Google only** (#186, closes it).
  - ADR-0011 and ADR-0019 are marked superseded in part (no password login, no `SESSION_SECRET`). ADR-0021 gets
    amendment 4: the AdSense crawler login is dropped, and AdSense reviews the public pages. ADR-0025's gate B
    amendment records the six PRs (#897, #898, #899, #902, #903 and this one).
  - `go-live-api.md`: Google and database settings instead of the password hash and session secret; the smoke test
    uses a signed-in browser's `sd_session` cookie; the edge rate-limit rule targets `/api/auth/google/`; emergency
    sign-out is `npm run admin -- revoke-sessions --all`; the IP spoof test reads a bare Google callback's
    `google sign-in failed` line.
  - `load-testing.md` and `database.md` drop the old settings. `frontend/CLAUDE.md` no longer says the AdSense
    crawler signs in.

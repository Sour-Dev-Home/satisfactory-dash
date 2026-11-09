- **`/pair` opens the pair page.** Mod 0.3.0 prints "sign in at https://satis-manager.com/pair" on the server console, so
  `/pair` now redirects to `/app/pair` (`ToPair` in `frontend/src/shell/ToApp.tsx`, routed in `App.tsx`). It drops the
  query string instead of forwarding it, so a `?code=` link can't prefill a code (ADR-0051 section 1). The Worker already
  serves the app shell for unknown paths, so no Worker change. Tests in `ToApp.test.tsx`.

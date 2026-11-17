- **Sign-up is open in the copy** (owner, 2026-11-17: the Google OAuth app is published, #186; `SIGNUP_MODE` has been `open` since 2026-11-10).
  - The landing page says "Anyone with a Google account can sign in." instead of "Sign-in is invite-only during the beta."
  - Getting started and Setting up from scratch drop the invite-only lines. The first Google sign-in creates the account that
    approves a pairing code. The changelog gets a 17 November entry.
  - `not_invited` (shown only if `SIGNUP_MODE` is closed again) now says sign-up is closed, not invite-only.
  - Tests and the e2e landing marker follow. The landing baselines are regenerated.

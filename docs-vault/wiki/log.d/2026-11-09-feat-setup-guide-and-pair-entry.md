- 2026-11-09 — Mod 0.3.0's end-to-end findings reach the guides and the app. New guide "Setting up a server from
  scratch" (order 2; the rest renumbered): hosting, the game's ports (7777 TCP and UDP, 8888 TCP), SML 3.12.0 or later
  and the mod on the server, pairing, the dashboard, and SML on every player's game. "Connecting a server" no longer says
  players need nothing: a server with SML refuses a vanilla client, so players need SML (not the Satis Manager mod); it
  also points container users at `FactoryGame.log`, says to type the chat code, and says the map can show the old
  factory for up to about 9 minutes after pairing onto an existing server. Settings' Satis Manager mod section gains a
  "Pair a server" link to `/app/pair` for every member, and the pairing code's hint says codes never contain 0, 1, 8 or
  9 (lower case and missing dashes were already accepted). New raw source `mod-0.3.0-requirements-2026-11-09.md`
  quotes the mod repo's plugin descriptor, release notes and end-to-end record for these claims.
- **Mod v0.3.0 is released** (2026-11-09, the owner's go). The guides now link its GitHub releases page in place of "not
  published yet":
  - `connecting-a-server.md`, `setting-up-from-scratch.md` and `faq.md` now link it.
  - They say the mod isn't in SMM's catalogue yet, so it's added by hand after SML.
  - The pairing steps say sign-in is invite-only during the beta, so pairing needs an existing account until sign-up opens (#186, `SIGNUP_MODE`).
  - `faq.md` loses the same "players install nothing" error.

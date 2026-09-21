# adapters

Owns all communication with a Satisfactory server: the vanilla Dedicated Server HTTPS
API and the FicsitRemoteMonitoring (FRM) JSON API. This is the one place in the
codebase allowed to know about FRM/vanilla-API response shapes — see the "isolate the
game-server adapter" rule in the root `CLAUDE.md`.

Each adapter should implement a shared internal interface (e.g. `getFactoryState()`,
`getPlayers()`) so `routes/` and `services/` never depend on which underlying API — or
which specific game server — the data came from. That indirection is what makes
"one server now, many via AWS later" a config change instead of a rewrite.

Empty until `docs-vault/raw-sources/` has real API docs/samples to ground it against —
see ground rule 2 in the root `CLAUDE.md`.

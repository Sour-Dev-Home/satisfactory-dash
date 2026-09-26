# gameserver module

A thin facade (ADR-0014, ADR-0031 PR 2). Everything that talks to ONE Satisfactory server
(the vanilla Dedicated Server HTTPS API and the FicsitRemoteMonitoring JSON API) now lives
in the `@satisfactory-dash/game-adapter` package (`packages/game-adapter/`, see its
README, including the `GetServerOptions` secret rule), so the edge agent can reuse it.

What stays here is backend-only:

- `index.ts` — the module's public API. It re-exports the package and adds the config
  loaders below. Other modules import only from here, never a deep path and never the
  package directly (`src/architecture.test.ts`, rule 7).
- `connectionConfig.ts` — assembles a `SatisfactoryServerConfig` (the type is the package's)
  from environment variables; see `backend/.env.example`. Throws `ConfigError`
  (`platform/errors.ts`), so the backend refuses to start on a bad value.
- `serversFile.ts` — the servers file loader (`servers.example.json`).
- `captureSeries.ts` — a helper for the `capture-factory` script.

It imports no Express and no other module, and of `platform/` only `errors.ts`.

# gameserver module

A thin facade (ADR-0014, ADR-0031 PR 2). Everything that talks to ONE Satisfactory server
(the vanilla Dedicated Server HTTPS API and the FicsitRemoteMonitoring JSON API) now lives
in the `@satisfactory-dash/game-adapter` package (`packages/game-adapter/`, see its
README, including the `GetServerOptions` secret rule), so the edge agent can reuse it.

What stays here is backend-only:

- `index.ts` — the module's public API, a re-export of the package. Other modules import
  only from here, never a deep path and never the package directly
  (`src/architecture.test.ts`, rule 7).
- `captureSeries.ts` — the helpers of the retired `capture-factory` script (its FRM captures stay
  in `docs-vault/raw-sources/`).

ADR-0066 build PR 5 removed the environment and servers-file loaders (`connectionConfig.ts`,
`serversFile.ts`) and the `capture-factory` script that read FRM with them: no server is built
with a game connection any more. The module itself goes in build PR 7.

It imports no Express and no other module, and of `platform/` only `errors.ts`.

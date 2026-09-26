# Frontend: wiring a new endpoint or screen

A checklist for adding a backend endpoint to the frontend, or a new screen or section. It lists every place
that must change, in order, so nothing is found missing by CI (#289). `frontend/CLAUDE.md` has the rules
behind each step; this page is the order and the files. The worked example is the agent section (#262):
`frontend/src/agent/`, `api/agentWrites.ts`, and the `agent*` entries in each file below.

## 0. Before you start

- [ ] **Your worktree has its own install.** Run `npm ci` in the worktree root, then check that
      `node_modules/@satisfactory-dash/shared` exists. Without it, imports resolve up to the main checkout's
      `node_modules` and its older `packages/shared`, and typecheck or tests fail with missing exports or
      `Cannot read properties of undefined (reading 'route')`. If `npm ci` fails with "operation was rejected",
      a dev server from this worktree still holds a file: find it (don't start one; see `frontend/CLAUDE.md`).
- [ ] **The contract exists on `main`.** The endpoint in `packages/shared/src/endpoints.ts`, its schemas, its
      exported types and fixtures in `packages/shared/fixtures/`. `packages/shared` isn't the frontend's to
      edit. A missing piece (e.g. a schema exported without its `z.infer` type) goes to its owner; meanwhile
      infer it locally with `import type { z } from "zod"`.

## 1. Reads and writes (`src/api/`, not tier:ui)

- [ ] **Read:** an entry in `queries.ts`, keyed `["servers", serverId, ...]`. A polled read gets a
      `POLL_MS.<name>` constant, and `queries.test.tsx`'s `POLL_MS` equality test gains it.
- [ ] **Write:** a `use<Area>Writes(serverId)` hook in `api/<area>Writes.ts` (pattern: `alertWrites.ts`). Use
      `apiSend(endpoint, body | undefined, ...args)`, and on success patch the cache or invalidate the read.
- [ ] **Secrets** (tokens, webhook URLs, enrolment codes): never a mutation's variables or kept data. Pass
      the input through a ref, set `gcTime: 0`, copy an answer into component state and call `reset()`. Add a
      test that the MutationCache is empty and no query holds the secret.
- [ ] **A synchronous guard** on a create button (a ref), when a double click would create two things:
      `isPending` lags two clicks in the same tick.
- [ ] **Nothing reads `import.meta.env` outside `api/transport.ts`.** Use `apiHref("")` from `api/client.ts`
      for the API origin. Reading `VITE_API_URL` elsewhere inlines the real URL into the demo bundle
      (`e2e/build-output.spec.ts` fails).

## 2. The screen (`src/<area>/`)

- [ ] A thin container (the queries and writes) plus a presentational component that takes schema types as
      props. Text and permission rules go in a plain `.ts` helper with its own tests.
- [ ] **Placed in `shell/Shell.tsx`** inside a `<Section label probe>`, and keyed by `server.id` if its state
      must not follow the user to another server.
- [ ] **Permissions:** `server.role` (owner, admin, viewer) and `queries.servers().data?.canManageServers`
      (the operator) hide controls that would answer 403. The backend enforces them. A user without the
      control gets a line saying who can.
- [ ] **Tokens only.** No raw colour, size, radius or duration: `npm run lint` fails at 0 exceptions. Add a
      token in `@theme` in `index.css` if none fits.
- [ ] **The client clock never drives a warning.** Ages are text; "late", "offline" and "expired" come from the
      backend (e.g. `stale`, `online`).
- [ ] **Focus:** a control that swaps itself for a confirm moves focus into it, and back on cancel. Use a
      stable `useCallback` ref: a view that re-renders every second re-focuses with an inline one.
- [ ] **Layout-stable loading:** a placeholder above other content reserves its final height (a token), or the
      page reveals once. `e2e/tab-switch.spec.ts` fails a shift above CLS 0.02.

## 3. Mocks, three of them

- [ ] **Unit tests:** a default handler in `src/test/handlers.ts`, built from a shared fixture.
- [ ] **e2e and `dev:mock`:** in `src/test/scenarios.ts`, the endpoint in `ROUTES` (same path, other method is
      fine), a default in `BASE`, and named `SCENARIOS` for each new UI state. `scenarios.test.ts` fails if a
      route has no answer, or an answer doesn't match the contract.
- [ ] **Demo:** a handler in `src/demo/handlers.ts` (wrapped in `guarded`), with data from `src/demo/world.ts`,
      made up, never the test fixtures. A write is either in memory or refused like server changes (403).

## 4. Tests and screenshots

- [ ] Vitest + RTL + MSW for the container: every role, loading, error with Retry, and each write's success and
      error. `@testing-library/user-event` isn't installed; use `fireEvent`.
- [ ] A case in `e2e/states.spec.ts` for each new state (`path`, `act`, and a fixed `clock` whenever time
      shows on screen). Local e2e may be blocked; `gh workflow run e2e.yml --ref <branch> -f
      update_snapshots=true`, then download `playwright-baselines`.
- [ ] **Commit only the images your change explains.** Other drift is noise: the PR's own e2e passing on
      the old baselines proves it.

## 5. Before "ready"

- [ ] `npm run lint`, `typecheck`, `build`, `build:demo`, and `npx vitest run --reporter=dot` (in `frontend/`,
      with `set -o pipefail`).
- [ ] A `docs-vault/wiki/log.d/` fragment. No real name or local path anywhere: files, commit messages, PR
      title and body.
- [ ] **Tier:** anything under `api/`, `auth/`, `demo/handlers.ts` or `test/browser.ts`, or any new query, is
      not tier:ui (the architect reviews). A QUICK test-hunter on new `.ts` logic, and a ui-review for
      anything users see (the mock server needs the owner's OK via `reactapps-dc`).

# satisfactory-dash

A web dashboard + backend that connects to a live Satisfactory dedicated server and
surfaces player-specified data (production rate, overflow, power outages, and more).
Monolith for now; designed so it can later scale to multiple game servers on AWS, and
designed so its module boundaries can later be owned by separate agents.

See also: `frontend/CLAUDE.md`, `backend/CLAUDE.md`, `packages/shared/CLAUDE.md` for
module-scoped rules — those load automatically when working in that directory.

This is a **public-facing** project per `../DEPLOYMENT.md` — public repo, Cloudflare
Pages hosting for `frontend/` (not yet connected). See that file before changing repo
visibility or hosting.

See `../WORKFLOW.md` for session roles, the branch/PR loop, and this repo's status
against the workspace's security/CI baseline.

## Ground rules

1. **Ask before building.** Before implementing anything non-trivial, ask clarifying
   questions and propose an approach. Do not start writing code until we've aligned.
2. **Cite or flag.** Any claim about the Satisfactory Dedicated Server HTTPS API, the
   FicsitRemoteMonitoring (FRM) mod's JSON API, or Satisfactory Mod Loader (SML) must
   cite a file under `docs-vault/raw-sources/`. If it isn't documented there, write
   `[NEEDS VERIFICATION]` instead of guessing. Modding this game from memory produces
   hallucinated API calls — treat anything not grounded in `docs-vault/` as suspect.
3. **Prefer the fixed chain over the agent.** Power-outage detection, overflow alerts,
   and production-rate math are deterministic — a scheduled poll + threshold check, not
   an LLM call. Only reach for AI/agent behavior where the task is genuinely open-ended
   (e.g. summarizing a factory's health in plain language).
4. **Don't build the custom mod first.** Two data sources already exist and should be
   exhausted before writing any UE5/SML code:
   - Vanilla Dedicated Server HTTPS API (`docs-vault/raw-sources/dedicated-server-api.md`)
   - FicsitRemoteMonitoring JSON API (`docs-vault/raw-sources/frm-*.md`)
   Only build a custom mod for metrics neither source provides. Keep that gap list at
   `docs-vault/wiki/data-gap-analysis.md`.
5. **Isolate the game-server adapter.** All communication with a Satisfactory server
   (vanilla API or FRM) goes through `backend/src/modules/gameserver/`. No FRM- or
   API-specific response shapes leak into React components or the database schema —
   the backend exposes its own clean REST/WebSocket contract, defined in
   `packages/shared/`, to the frontend.
   This is what makes "one server now, many via AWS later" a config change, not a rewrite.
6. **Contract changes are isolated changes.** A change to `packages/shared/` is a
   breaking-change candidate for both `frontend/` and `backend/`. Don't bundle it with
   unrelated work, and update every caller on both sides in the same change.
7. **No PII or hardcoded local paths in committed files.** Never commit a real name
   (as identifying data, not public branding), personal email, phone number, or an
   absolute local filesystem path (e.g. `C:\Users\...`) into anything tracked by this
   repo. Personal/career context files live outside the repo (see `../about-me.md` at
   the workspace root) or in a git-ignored location — never inside `satisfactory-dash/`
   itself. Before committing, check `git status`/`git diff` for anything that looks
   like a leaked path or contact detail, not just for correctness.

## Team topology (Conway's Law)

This repo is structured so its directory boundaries can become agent-ownership
boundaries without restructuring, once subagents are introduced:

| Directory | Future agent | Depends on |
|---|---|---|
| `frontend/` | frontend agent | `packages/shared/` types + `backend/` REST/WS contract only |
| `backend/src/modules/{telemetry,servers,identity}/` (routes and services inside each) | backend agents | `backend/src/modules/gameserver/` via its `index.ts`, fixture data for tests; expose `packages/shared/` |
| `backend/src/modules/gameserver/` | data-adapter agent | `docs-vault/` only — never guesses |
| `packages/shared/` | shared by all — changes here require review from whichever agent owns the other side of the change |

The point of drawing these lines now, before multiple agents exist, is that Conway's
Law runs in both directions: if the code has no deliberate boundaries, whatever agents
get added later will draw them ad hoc through however they happen to divide work. Bad
module boundaries are much more expensive to fix once multiple agents' histories are
built around them than to set up correctly now, while the codebase is still small.

## Docs vault

- `docs-vault/raw-sources/` — immutable. Saved copies of official docs, captured API
  responses, SML references. Never edit these, only add to them.
- `docs-vault/wiki/` — living, AI-maintained notes derived from raw-sources: summaries,
  the data-gap analysis, decisions. `index.md` catalogs every page; `log.md` is an
  append-only record of what changed and when.

## Legal

See `LEGAL.md`. Short version: code in this repo is MIT-licensed; monetization
strategy is undecided and gated on verifying FicsitRemoteMonitoring's actual license
and Satisfactory's EULA directly — don't assume either is settled.

## Stack (current)

npm workspaces monorepo: `frontend`, `backend`, `packages/shared`. One install, one
lockfile, one `node_modules` at the root (workspace packages are symlinked in).

- `frontend/` — Vite + React + TypeScript SPA. Plain client-side React (hooks,
  components) — no server components, no file-based routing magic.
- `backend/` — Express + TypeScript API server, bundled by `esbuild` into a single
  self-contained `dist/server.cjs` (no `node_modules` needed at runtime). Has a
  `Dockerfile` for portability to Render/Railway/AWS ECS later.
- `packages/shared/` — TypeScript types shared between `frontend` and `backend`
  (the API contract). Source-only, no build step.

This is a two-process monolith (frontend dev server + one backend process), not a
single-process framework app. When "AWS later" comes up, it's the `backend/` process
that scales out to talk to multiple game servers; `frontend/` stays as-is. Not yet
deployed anywhere — see `../DEPLOYMENT.md` for the plan (Cloudflare Pages).

## Custom agents

Three custom agents exist for this workspace: `security-reviewer`, `test-hunter`,
`portfolio-updater`, defined at `~/.claude/agents/` (user-global — a workspace-root
`.claude/agents/` was tried first and never actually worked, since `ReactApps/` isn't
a git repo and Claude Code never scanned it).

**Important, easy to relearn the hard way:** a custom agent is only discoverable by
the Agent tool in sessions started *after* its definition file existed (same rule
seems to apply to MCP servers). If `Agent type 'X' not found` shows up for an agent
you know exists, that's not a bug to debug — it means this session predates the file
(or a recent edit to it). Start a fresh session instead of investigating further.

`test-hunter` specifically: invoke it as a fresh subagent (never a fork — a fork
inherits full context, defeating the point) after a chunk of backend logic is written,
so it reviews with genuinely no memory of why the code was built a certain way.

## Testing

- `npm run test` from the root runs both workspaces' suites (Vitest everywhere;
  Supertest for backend route tests, React Testing Library for frontend components).
- Every route under `backend/src/modules/*/routes/` should have a test that hits the
  Express `app` export directly. Every service under `backend/src/modules/*/services/`
  should be testable with
  fixture data — no live game server required to run the suite.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all run in CI
  (`.github/workflows/ci.yml`) on every push and PR; treat a red CI run as blocking.
- **Fresh-eyes step** (see `../WORKFLOW.md`): any PR that adds or changes real logic is
  opened as a DRAFT. Before `gh pr ready`, spawn a fresh `test-hunter` subagent (never a
  fork, which would inherit your context) scoped to the changed files, land its tests
  and any fixes on the same branch, and repeat until it stops finding real bugs.
  Docs-only and config-only PRs skip it. (This replaced a CI job of the same purpose,
  which ran on API credit and was retired.)

## Commands

Run from the project root (`satisfactory-dash/`):

- `npm install` — install deps for all workspaces (first time only)
- `npm run dev` — start both dev servers together (frontend on
  http://localhost:5173, backend on http://localhost:3001)
- `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` — run across
  all workspaces; each also works scoped, e.g. `npm run test -w backend`

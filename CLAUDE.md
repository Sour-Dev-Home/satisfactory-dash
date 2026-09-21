# satisfactory-dash

A web dashboard + backend that connects to a live Satisfactory dedicated server and
surfaces player-specified data (production rate, overflow, power outages, and more).
Monolith for now; designed so it can later scale to multiple game servers on AWS.

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
   (vanilla API or FRM) goes through one adapter module in `backend/src/`. No FRM- or
   API-specific response shapes leak into React components or the database schema —
   the backend exposes its own clean REST/WebSocket contract to the frontend.
   This is what makes "one server now, many via AWS later" a config change, not a rewrite.

## Docs vault

- `docs-vault/raw-sources/` — immutable. Saved copies of official docs, captured API
  responses, SML references. Never edit these, only add to them.
- `docs-vault/wiki/` — living, AI-maintained notes derived from raw-sources: summaries,
  the data-gap analysis, decisions. `index.md` catalogs every page; `log.md` is an
  append-only record of what changed and when.

## Stack (current)

Two separate npm projects, run together in dev, deployed as two processes:

- `frontend/` — Vite + React + TypeScript SPA. Plain client-side React (hooks,
  components) — no server components, no file-based routing magic.
- `backend/` — Express + TypeScript API server (`backend/src/server.ts`). This is
  where the Satisfactory-server adapter, polling, and REST/WebSocket endpoints for
  the frontend live.

This is a two-process monolith (frontend dev server + one backend process), not a
single-process Next.js app. When "AWS later" comes up, it's the `backend/` process
that scales out to talk to multiple game servers; `frontend/` stays as-is.

## Commands

Run from the project root (`satisfactory-dash/`):

- `npm run install:all` — install deps for both `frontend/` and `backend/`
- `npm run dev` — start both dev servers together (frontend on
  http://localhost:5173, backend on http://localhost:3001)

Or per-project, from inside `frontend/` or `backend/`:

- `npm run dev` — start that project's dev server
- `npm run build` — production build
- `npm start` (backend only) — run the built server from `dist/`

# satisfactory-dash

A web dashboard + backend for a live Satisfactory dedicated server: production rate,
overflow, power outages, and more. Two-process monolith for now (Vite/React frontend +
Express/TypeScript backend), designed to scale to multiple servers on AWS later. See
`CLAUDE.md` for the working rules Claude Code follows in this project, and `LEGAL.md`
for the (unresolved) licensing/monetization question.

## Getting started

```bash
npm install   # first time only: installs all workspaces
npm run dev   # starts both dev servers
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (try http://localhost:3001/api/health)

## Project layout

npm workspaces monorepo:

- `frontend/` — Vite + React + TypeScript SPA
- `backend/` — Express + TypeScript API server; this is where the Satisfactory
  dedicated-server / FicsitRemoteMonitoring adapter will live
  (`backend/src/modules/gameserver/`)
- `packages/shared/` — TypeScript types shared between frontend and backend (the API
  contract)
- `docs-vault/raw-sources/` — immutable copies of Satisfactory API docs and sample
  responses (see the README inside for what to add)
- `docs-vault/wiki/` — living notes Claude maintains from raw-sources, including
  `data-gap-analysis.md`

## Commands

- `npm run dev` — both dev servers together
- `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` — across all
  workspaces (also runs in CI on every push/PR — see `.github/workflows/ci.yml`)

## Deployment

- **Frontend** → Netlify (connect the repo in the Netlify dashboard; build command
  `npm run build -w frontend`, publish directory `frontend/dist`)
- **Backend** → not yet deployed anywhere. Has a `Dockerfile` ready for
  Render/Railway/AWS when there's real logic worth deploying.

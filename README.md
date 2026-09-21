# satisfactory-dash

A web dashboard + backend for a live Satisfactory dedicated server: production rate,
overflow, power outages, and more. Two-process monolith for now (Vite/React frontend +
Express/TypeScript backend), designed to scale to multiple servers on AWS later. See
`CLAUDE.md` for the working rules Claude Code follows in this project.

## Getting started

```bash
npm run install:all   # first time only: installs frontend/ and backend/ deps
npm run dev            # starts both dev servers
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (try http://localhost:3001/api/health)

## Project layout

- `frontend/` — Vite + React + TypeScript SPA
- `backend/` — Express + TypeScript API server; this is where the Satisfactory
  dedicated-server / FicsitRemoteMonitoring adapter will live
- `docs-vault/raw-sources/` — immutable copies of Satisfactory API docs and sample
  responses (see the README inside for what to add)
- `docs-vault/wiki/` — living notes Claude maintains from raw-sources, including
  `data-gap-analysis.md`

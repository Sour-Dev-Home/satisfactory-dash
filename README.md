# satisfactory-dash

A web dashboard + backend for a live Satisfactory dedicated server: production rate,
overflow, power outages, and more. Monolith for now, designed to scale to multiple
servers on AWS later. See `CLAUDE.md` for the working rules Claude Code follows in
this project.

## Getting started

```bash
npm run dev
```

Open http://localhost:3000.

## Project layout

- `src/` — Next.js app (App Router, TypeScript, Tailwind)
- `docs-vault/raw-sources/` — immutable copies of Satisfactory API docs and sample
  responses (see the README inside for what to add)
- `docs-vault/wiki/` — living notes Claude maintains from raw-sources, including
  `data-gap-analysis.md`

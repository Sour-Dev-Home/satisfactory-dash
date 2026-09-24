# ADR-0024: Architecture as code: one Structurizr model, AI-authored, CI-validated, drift-checked

Status: accepted (project owner), 2026-09-24

## Context
The owner wants the best available AI-driven architecture-diagram workflow for satisfactory-dash
and the portfolio. Today: four hand-written D2 files (docs-vault/wiki/architecture/, from the
architect), each an independent picture. Nothing keeps them consistent with each other or with
the code. Current practice, from research:
- **Model, not pictures:** a C4 model defined once as code produces every view (context,
  container, component, deployment), consistent by construction. Structurizr, from the C4
  model's author, is the reference tool (structurizr.com; docs.structurizr.com).
- **AI authoring with a validator in the loop:** the Structurizr MCP server lets an agent validate,
  parse and inspect DSL and export views to Mermaid/PlantUML. It doesn't render images
  (docs.structurizr.com/ai/mcp). It runs as Docker, a Java 21 jar, or the hosted
  mcp.structurizr.com.
- **Drift detection:** compare the declared architecture with the actual dependency graph from static
  analysis, in CI (dependency-cruiser for TypeScript; fitness functions).
- **Decisions attached to the model:** Structurizr's `!adrs` imports ADR markdown into the
  workspace (adr-tools default, MADR, log4brains, or a custom importer; docs.structurizr.com/dsl/adrs).
- This machine has neither Docker nor Java. GitHub-hosted CI runners have Docker.

## Decision
1. **One source of truth:** `docs-vault/workspace.dsl` (at docs-vault/ root so `!adrs wiki/decisions` is a subdirectory, as Structurizr requires) models people, software systems,
   containers (SPA, Cloudflare edge, tunnel, backend, game APIs), backend components (the
   modules/ layout), and deployment environments (today; planned AWS). It includes views for
   system context, containers, backend components, deployment-today and deployment-target, and it
   tags elements `planned` so one model shows both states. The existing D2 files are retired as
   sources.
2. **AI authoring loop (the architect session):**
   - edit the DSL whenever an ADR changes topology or module edges
   - validate and inspect it via the Structurizr MCP (hosted connector; the model holds only public
     architecture facts)
   - render and LOOK at the images before handing them off
   - a fresh reviewer agent may critique diagram readability
3. **CI job (coordinator owns .github), on PRs touching docs-vault/workspace.dsl or backend/src/modules:**
   - (a) `structurizr/cli` Docker image: validate + inspect (fail on errors)
   - (b) export every view (Mermaid for GitHub rendering; PlantUML/C4-PlantUML -> SVG; a
     static-site export as an artifact)
   - (c) **drift check:** dependency-cruiser builds the actual backend/src/modules import graph; a
     small script compares it with the model's component relationships (matched by a
     `code:modules/<name>` property) and fails on any undeclared or missing edge. This complements
     architecture.test.ts: the test enforces rules, the drift check enforces model = code.
4. **Decisions in the model:** `!adrs wiki/decisions` attaches the ADRs. The heading format is
   [NEEDS VERIFICATION] against the adr-tools importer: ADRs use "# ADR-NNNN: Title" and
   "Status:" lines. If it doesn't parse, adopt MADR headings for new ADRs, or a small custom
   importer.
5. **Portfolio assets:** the CI-rendered SVGs are the accurate, always-current set. For one or two
   hero images, D2 remains an optional presentation layer, regenerated FROM the model's elements
   by the architect with the visual self-review loop. It's never a separate source of facts.
6. **Rule:** a PR that changes topology or module dependencies updates workspace.dsl in the same
   PR; the drift check makes that non-optional for the backend.

## Consequences
- Consistent diagrams at every zoom level, validated, and provably matching the code for the backend.
  That's strong portfolio evidence ("architecture as code with drift detection").
- New moving parts: one CI job (Docker image, pinned by digest), dependency-cruiser (dev dependency), and
  a small comparison script. Local rendering needs Docker/Java later if wanted; CI covers it meanwhile.

## Phases
| Phase | Owner | Output |
|---|---|---|
| 1 | architect -> dev commits | workspace.dsl with all views, validated via MCP |
| 2 | coordinator | CI: validate/inspect/export/render, artifact |
| 3 | dev | dependency-cruiser + drift script, required once green |
| 4 | dev | !adrs integration (format check) |
| 5 | architect -> portfolio session | refreshed assets from CI renders (+ optional D2 hero) |

## Revisit when
- More than one repo needs modelling (then one Structurizr workspace across systems).
- The frontend's module structure grows enough to drift-check it too.

# ADR-0007: No URL versioning; expand -> migrate -> contract once a consumer exists

Status: accepted, 2026-09-22

## Context

One frontend and one backend, same repo, deployed separately (Cloudflare Pages vs a
backend host), so skew windows exist. No external consumers.

## Decision

No /api/v1 prefix. Additive = new field, new endpoint, or new error code. Breaking =
rename, removal, retype, a unit/scale change with the same type, or a new enum value (except
error codes). Once a deployed consumer exists (from PR 4), a breaking change goes expand ->
migrate frontend -> contract, each step its own PR (ground rule 6). Before that, a rename is one
step. Today the frontend imports only HealthResponse (frontend/src/App.tsx:2).

## Consequences

No version plumbing. Discipline replaces versioning.

## Revisit when

An external consumer exists, or a breaking change can't be staged. Then add /api/v2
for the affected routes only.

# ADR-0002: Zod schemas in packages/shared are the single contract source

Status: accepted, 2026-09-22

## Context

packages/shared/src/index.ts holds plain TypeScript interfaces. Types vanish at runtime,
so backend/frontend drift shows up only as broken UI. The frontend deploys to Cloudflare Pages
separately from the backend, so versions will be skewed at times.

## Decision

Zod 4 schemas in packages/shared define every response; types come from z.infer. An
endpoint map (endpoints.ts) ties method, route, path builder and response schema together. Fixtures
live in packages/shared/fixtures (a "./fixtures" subpath export, tests and MSW only), and a shared
test asserts every fixture parses. Enforcement:
- Frontend: one apiGet() safeParses every response; a failure raises a visible contract-drift
  error, never a silent blank.
- Backend: route tests assert schema.parse(body) equals body. In every environment, responses go
  through one sendValidated() helper that sends the PARSED output (unknown keys stripped, so
  nothing leaks by accident). A validation failure is logged with its zod issues and returns
  500 internal.
- Objects are non-strict (z.object) so an additive backend field doesn't break a deployed frontend.
- Root typecheck/test scripts include -w packages/shared.
Raw FRM/vanilla shapes are validated in backend adapters (adapters/rawSchemas.ts), never in shared.

## Consequences

Drift fails in CI (fixture + route tests) or loudly at runtime. zod becomes a runtime
dependency of both apps. Outbound validation costs a little CPU per response.

## Revisit when

Validation shows up in latency profiles, or an external consumer needs OpenAPI
(generate it from the schemas with z.toJSONSchema then).

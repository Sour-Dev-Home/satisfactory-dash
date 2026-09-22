# ADR-0008: Structured logging with pino, now

Status: accepted, 2026-09-22

## Context

console.error in routes/errorResponse.ts:86 and console.log in server.ts:30. The error
envelope (ADR-0003) hides detail from clients, so full errors need somewhere to go.

## Decision

pino (JSON to stdout) + pino-http, with the ADR-0003 request id bound per request; same
PR as the error middleware. Full error detail and zod issues go to logs only. Never log tokens,
passwords, cookies or GetServerOptions output; configure pino redaction for auth headers and cookies.

## Consequences

Logs are machine-queryable. On AWS, container stdout goes to CloudWatch Logs with no
code change.

## Revisit when

There is more than one service (then OpenTelemetry tracing), or alerting needs
metric filters.

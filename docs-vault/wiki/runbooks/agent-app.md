# Runbook: the edge agent program (retired)

> **Retired by ADR-0066 (2026-11-09).** The Node edge agent (`agent/`) and the Electron server manager (`server-manager/`)
> are deleted; ADR-0040 is superseded. A server connects only through the SatisDashAgent mod, which speaks the same
> `/agent/v1` protocol (the backend side is in [`agents.md`](./agents.md)). This page stays only because the dashboard's
> update notice and some code comments still link here; they move with ADR-0066 build PRs 2, 7 and 9, and this page is
> deleted then. The older agent-linux, server-manager and agent-switch-over runbooks are already deleted; git history has
> the full text of all four.

## Conform, don't reject

The rule the agent followed, and which the backend's ingest and the adapter's mappers still cite: a sender conforms every
reading to the backend's input bounds before it sends (strings cut to 200, lists capped, float noise clamped, a
non-finite number dropped with its entry), so one bad item is dropped rather than the whole snapshot refused.

## Removing an old install

Delete the Scheduled Task, run `node agent.cjs forget-credential`, revoke the agent in the dashboard, and delete the data
folder. The game tokens lived only in `store.json`, so deleting it removes them too.

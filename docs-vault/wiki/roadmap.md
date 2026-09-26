# Roadmap and success metrics

What "a successful product" means for Satisfactory Dash, stated as targets that can be checked.
Targets approved by the owner on 2026-09-25 (ADR-0033). Tasks live on the project board, and design
decisions in `decisions/`. This page only says where the product is heading and how we know it
got there.

## Where it stands
- **Running:** the live dashboard (overview, power, factory, players, settings) for the owner's
  server; accounts with sessions and an audit log; nightly encrypted backups with a rehearsed restore;
  privacy and terms pages.
- **Built, not yet deployed:** managing servers from the dashboard (ADR-0030 phase 1: encrypted
  tokens, loopback servers only until certificate pinning) and recorded production history
  (ADR-0027 PR 3).
- **In progress:** history API and charts, then alerts to Discord (ADR-0027).
- **Later:** Google sign-in going live; other players' servers through an edge agent (ADR-0031,
  phase 2); latency and UX budgets (ADR-0032, proposed).

## Success metrics

| Area | Target | How it is measured |
|---|---|---|
| Time to dashboard (operator) | A server added in the dashboard shows live data in **under 2 minutes** | Time from the `server.created` audit event to the first successful poll in the logs |
| Time to dashboard (new player, phase 2) | Sign-in to live data in **under 10 minutes** | A timed walkthrough on a fresh account; later, from audit events |
| Alert speed | A real stall is notified within the rule's `for` duration **+ 60 seconds** | Condition start (recorded history) vs the Discord delivery time in the outbox |
| Alert quality | **At most 1 false alarm per month** | A weekly review of the alert log |
| Adoption | **At least 1 other player's server** connected | Count of agent-connected servers (phase 2) |
| Security | **0 incidents**: no leaked secret, no unauthorised access | Audit log review; secret scanning |
| Security hygiene | **No high or critical** CodeQL or Dependabot alert open **more than 7 days** | GitHub security alerts |
| Release safety | A **security review before every deploy** | The review PR or comment linked from the deploy |

## Revisit
Targets change only with the owner's approval. When one is met for a month, raise it or replace it
with the next thing that matters. When one keeps failing, the fix goes on the board before new
features in that area.

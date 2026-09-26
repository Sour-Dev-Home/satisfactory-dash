# ADR-0032: Latency and UX budgets

Status: accepted (owner, 2026-09-26: the five steps in order, the public scheduled probe, and tab-switch
pop-in as the first UX test)

## Context
- The owner asked how to measure latency and how to keep the UI from feeling "laggy or weird": the
  trap where code passes its tests but nobody feels it. The only lag he notices today: switching tabs
  makes content **pop in piece by piece** instead of appearing together.
- The evidence for that: each view shows its own loading placeholders, around 26 "Loading…" and
  status placeholders across `frontend/src`, and each resolves when its own query does. The live
  queries (`status`, `power`, `factory`) have no `staleTime`, so a first visit starts several loads
  that finish at different times. Chart code is a lazy chunk (`ItemHistoryPanel.tsx`). Small
  placeholders replaced by taller content also shift the layout.
- What exists already: pino-http logs every request with its duration and request id. The envelope
  carries `observedAt` and `stale`. The event loop and readiness probes are timed. Playwright runs
  screenshot tests. Nothing aggregates the numbers, and nothing fails when things get slow or jumpy.
- The roadmap (ADR-0033 F) lists "speed" as a success metric pending this ADR.

## Decision
Three numbers matter: **server time** (backend and upstream), **end-to-end time** (browser → Cloudflare
→ backend), and **data age** (how old the numbers on screen are). Five steps, smallest first:

1. **Split the server time (dev).** Log the upstream time (game API, FRM) and the app time on each
   request's line. Add a `Server-Timing` header (`app;dur=…, upstream;dur=…`) plus `Timing-Allow-Origin`
   for the frontend's origin. Add `npm run latency-report`: p50, p95 and p99 per route and per upstream,
   from the daily logs. Proof: a unit test on a fixture log.
2. **Turn "feel" into failing tests (frontend, Playwright on demo data).**
   - **The first case, tab switching:** switching between the main tabs shows **no staged pop-in**.
     Placeholders reserve the final layout (skeletons the size of the content) and each view reveals
     once. Asserted as CLS ≤ 0.02 across a tab switch, with API responses delayed differently per
     endpoint (e.g. 100–600 ms), so staggered arrival can't cause shifts.
   - CLS ≤ 0.1 over a full poll cycle on every view. No spinner replaces content already shown.
   - INP ≤ 200 ms on the main clicks (switching tab or server, opening settings, the toggle).
   - A slow or failing network (2 s delays, 500s, timeouts): the last data stays with a visible stale
     badge, never blank, and it recovers.
   - A bundle-size budget in CI.
3. **Show data age (frontend).** "Updated 8 s ago" from `observedAt`, turning into a warning past 2x the
   poll interval. A dashboard that says honestly that it's stale never feels weird.
4. **An external probe (coordinator, CI).** A scheduled GitHub Actions job (about every 30 min) curls
   `/api/health/ready` and records DNS, TLS and total time in the job summary. It fails above 2 s. It's
   public in Actions and reads no data. After the AWS move it keeps working unchanged (same
   hostname).
5. **A human check (owner).** UI PRs attach a Playwright trace or video on a throttled network, and the
   owner does a two-minute check on a phone with "Fast 4G" throttling before a UI change counts as
   done.

For the tab-switch case, the likely fixes are the frontend's to choose, and the test pins the result:
- layout-stable skeletons;
- one coordinated reveal per view (wait for the view's primary queries together);
- prefetching the other tabs' primary queries when idle or on hover, and preloading the chart chunk.
The site-wide motion pass (ease-in-out, reduced motion honoured) can smooth the reveal, but a
transition must never delay data or focus, and the CLS budget holds with motion off.

## Deferred (each with its trigger)
- Real-user monitoring (browser timings sent back): trigger, users other than the owner. It needs a
  privacy row in the same PR.
- A cache in front of upstream calls: trigger, step 1 shows upstream time dominating p95.
- OpenTelemetry, CloudWatch dashboards and alarms: trigger, more than one service, or on AWS (the step 1
  logs carry over).
- API latency targets: trigger, one week of baseline from step 1. No invented numbers before that.

## Build plan
| # | PR | Owner | Tier |
|---|---|---|---|
| 1 | This ADR (docs) | dev | skip |
| 2 | Server time split, `Server-Timing`, `latency-report` | dev | QUICK |
| 3 | UX budget tests (tab switch first) and the fixes that make them pass; data-age label | fe | QUICK + ui |
| 4 | The scheduled probe workflow | coordinator | review (workflow) |
The frontend's PR 3 comes after the motion pass, so the budgets pin the final feel.

## Revisit when
- A budget is failing repeatedly (fix before new features in that area), or a week of step 1 data
  exists (set API targets).

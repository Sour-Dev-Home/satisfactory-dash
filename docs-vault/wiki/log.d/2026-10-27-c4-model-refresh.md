- 2026-10-27 — Refreshed the C4 model (`docs-vault/workspace.dsl`, ADR-0024) to today. Added the `metrics` component
  (ADR-0056) and the six import edges the drift check reported (metrics to alerts, identity and platform, the root
  wiring it, servers to identity, telemetry to map), so `npm run architecture:check` is green again. Rewrote the
  component descriptions to what each module does now (map's seven world layers and designations, alerts' Discord and
  web-push delivery, agents' pairing, commands and game reachability, telemetry's history, production graph and
  planner). Google sign-in and the player are no longer `planned`; Discord and the browsers' push services are new
  external systems; the web app and edge agent link to the modules they call. The deployment view gains the throwaway
  staging task and `deploy.yml`'s staged rollout (ADR-0049) and the overlap rollout with the leader lock (ADR-0054).
  Known, not fixed here: the pinned Structurizr image exports both deployment views as an empty 2000x2000 canvas (on
  main too); the component and container views render fine. Feeds the portfolio's /kit diagram (portfolio #86).

# ADR-0013: Deployment topology v1: Pages + home backend behind Cloudflare Tunnel

Status: accepted (project owner), 2026-09-22

## Context

The project owner registered satis-manager.com (Squarespace registrar). The frontend goes to
Cloudflare Pages (DEPLOYMENT.md); where the backend runs was undecided. The only game server
runs on the owner's own PC, and the backend must reach its HTTPS API (7777) and FRM (8080).
FRM's auth is a single static token, and it was exposed once during capture work. ADR-0011
requires the frontend and API on one site. On Cloudflare's free plan, both an apex Pages
domain and Tunnel public hostnames need the domain's nameservers on Cloudflare (partial/CNAME
setup is Business/Enterprise only):
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/dns/zone-setups/partial-setup/
- https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/

## Decision

- DNS: move satis-manager.com's nameservers from Squarespace to Cloudflare (free plan, full
  setup). Squarespace stays the registrar.
- Frontend: Cloudflare Pages at https://satis-manager.com.
- Backend: runs on the same PC as the game server and is published through a Cloudflare Tunnel
  (cloudflared, outbound-only) at https://api.satis-manager.com. It talks to the game server
  over loopback. No router port forwarding. Ports 7777/8080 are never published.
- Same site: satis-manager.com + api.satis-manager.com share a registrable domain, so ADR-0011's
  SameSite=Lax cookie works. CORS allows only https://satis-manager.com, with credentials.
- Local dev: the Vite dev server proxies /api to the local backend, so the browser sees one
  origin in dev too (same cookie behavior as production).
- Go-live gate (the tunnel stays off until all are true): PR 2b merged (server-scoped routes
  and validated responses); PR 3 merged (TLS verification + validated upstream data); PR 5 auth
  merged; FRM token rotated; the security-reviewer pass done.

## Consequences

- $0 hosting. The dashboard is up only while the owner's PC and the backend are running; the
  frontend then shows its upstream-unreachable state.
- Nothing listens on a public port at home; Cloudflare terminates TLS.
- The owner's PC is in the request path, so auth (ADR-0011) and rate limiting are the real
  perimeter.

## Revisit when

- The game server moves off the owner's PC, a second user's server is added (ADR-0001/0009), or
  the dashboard needs to be up while the PC is off. Then: the backend to AWS (ECS Fargate or App
  Runner) with secrets in SSM/Secrets Manager, logs to CloudWatch (ADR-0008). Reaching game
  servers from AWS needs its own security decision (never expose FRM directly).

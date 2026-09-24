# ADR-0019: API security posture at go-live, and what changes when it scales

Status: accepted (architect, delegated by the project owner), 2026-09-24

## Context
A read-only security-reviewer pass on main before the tunnel (ADR-0013) found nothing critical or
high. It confirmed:
- only health/login/logout/session are unauthenticated
- scrypt login with per-IP limits
- HttpOnly + Secure + SameSite=Lax 12 h cookies
- an exact CORS allowlist, and the CSRF guard
- loopback-only trust of CF-Connecting-IP
- fixed game/FRM function names (no SSRF), log redaction, and npm audit clean
Open findings: no security/cache headers (M1); sessions can't be revoked (M2); writes accept any
same-site subdomain (L3); SESSION_SECRET is only length-checked (L4); the login limiter is
in-memory and per-process (L5).

## Decision (go-live)
1. **Response headers (M1):** on every API response: X-Content-Type-Options: nosniff;
   Cache-Control: no-store on all /api responses (authenticated data must never be cached by
   Cloudflare or the browser); Referrer-Policy: no-referrer; `x-powered-by` disabled;
   `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (JSON is never
   rendered). Implemented as one small middleware; every header is tested.
2. **Sessions (M2):** TTL shortened from 12 h to 8 h. Tokens carry a random session id (jti).
   Logout adds that jti to an in-memory denylist until the token expires; the list is bounded
   and pruned. Known limit: a restart forgets the denylist. The emergency revoke-everything stays
   rotating SESSION_SECRET (documented in the runbook). Accepted for a single operator and a
   single backend process. Tokens issued before this change have no jti and are rejected, so
   the operator signs in once more after the upgrade.
3. **Cross-site writes (L3):** for every non-GET under /api, when an Origin header is present it
   must be in the CORS allowlist, even if Sec-Fetch-Site says same-site. That closes the
   sibling-subdomain path, alongside the rule that no satis-manager.com subdomain points at a
   third party (issue #19). A request the browser marks `same-origin` (the Vite dev proxy) or
   `none` (user-initiated) is not a sibling subdomain and is not held to the allowlist.
4. **Secret quality (L4):** startup requires SESSION_SECRET to be at least 32 bytes of randomness
   (e.g. at least 43 base64 characters, and not a known placeholder). The check is a length,
   variety and placeholder screen, not an entropy proof. The dev verifies the real one locally
   without printing it.
5. **Edge rate limit (L5, defence in depth):** one Cloudflare rate-limiting rule (Free plan: 1 rule,
   per IP, 10 s window, 10 s block) on `api.satis-manager.com/api/auth/login`: about 5 requests
   per 10 s per IP, then block. The backend's per-IP 15-minute limits stay authoritative. No
   Cloudflare cache rules on the API hostname; no wildcard CORS.
6. **Tunnel gate additions:** items 1-4 merged and the Cloudflare rule in place, plus the frontend's
   two open login fixes merged (done: #44), before the ADR-0013 tunnel goes on.

## When it scales (ADR-0009 / ADR-0014 / ADR-0017 triggers)
| Concern | Single backend today | At >1 backend instance or >1 user |
|---|---|---|
| Sessions | stateless signed token + in-memory jti denylist | server-side sessions (opaque id) in Postgres (or Redis if latency needs it); logout and "sign out everywhere" are real deletes |
| Login rate limit | in-memory per process + Cloudflare edge rule | a shared store (Postgres/Redis) keyed per IP and per account, plus a global failure cap (the IPv6 /56 note in issue #19) |
| Client IP | CF-Connecting-IP trusted only from the loopback peer (cloudflared) | an explicit trusted-proxy list per hop (e.g. ALB -> app sets X-Forwarded-For); never trust client-supplied headers from untrusted peers |
| Game credentials | backend/.env on the game PC | never in the cloud: edge agent + hashed per-server agent credentials; Secrets Manager for managed servers (ADR-0017) |
| Secrets for the backend itself | .env | SSM Parameter Store / Secrets Manager via IAM task role |
| Headers/CORS | app middleware | same middleware; the CORS allowlist from config per environment |

## Consequences
- Small, testable changes for launch, with one known limit (a restart forgets revocations)
  documented alongside its emergency procedure.
- The scaling table makes the future work explicit and tied to triggers, not built early.

## Revisit when
- A second user account or a second backend instance exists.
- Any security review finds a medium or higher issue.

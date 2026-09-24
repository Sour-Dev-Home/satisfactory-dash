# Privacy policy + terms: outline for satis-manager.com (DRAFT, not legal advice)

Status: architect draft, 2026-09-24. Owner answers (2026-09-24): the controller is the owner
personally, named **only** on the published privacy page (`frontend/public/privacy.html`, the
single file the CI PII scan excludes); contact `privacy@satis-manager.com` (live, a forwarding
alias); audit retention 1 year; log retention 14 days; legal review before publishing: yes.
Jurisdiction: a US-based operator. **Owner decision 2026-09-24: no state or other location is
published anywhere** (not on the pages, not in this repo). State-specific notes are kept
privately, outside all repositories.

## Which laws plausibly apply (for the reviewer to confirm; the page must not over-claim)
Stance: **describe what we actually do and offer the core rights to everyone**, without claiming
compliance with any statute that doesn't apply. (This isn't legal advice, just the questions for
the reviewer.)
| Law | Applies? | What the policy does |
|---|---|---|
| The operator's own state | Assessed privately, not in this repo [LEGAL] | Commit voluntarily to notifying affected users of a breach without undue delay |
| **CalOPPA** (California) | **Likely yes**: no size threshold; any commercial site collecting personal information from California residents [LEGAL: does a free, non-monetized service count as "commercial"?] | Include its required elements: categories collected, third parties, how to review/correct, how changes are notified, the effective date, **how we respond to Do Not Track** (we don't track across sites, so DNT changes nothing), and whether third parties track users over time (no) |
| CCPA/CPRA (California) | **No**: thresholds are revenue > $26.625M, 100,000+ California consumers, or 50%+ of revenue from selling/sharing data; a free service with <=5,000 users meets none | Don't claim CCPA rights; the voluntary rights section covers access and deletion anyway |
| Other state comprehensive laws (e.g. Virginia, Colorado, Texas, Florida, Tennessee) | **Probably no**: most have user-count thresholds far above ours; Texas/Nebraska-style laws use a small-business exemption instead [LEGAL: check Texas/Nebraska for a non-commercial individual] | Same voluntary stance; we never sell data or do targeted ads |
| **COPPA** (federal) | Applies only if the site is directed at under-13s or we have actual knowledge of under-13 users | Minimum age **13** (Google accounts also require 13+ in the US); delete an account on learning its user is under 13 |
| GDPR / UK GDPR | **Unclear**: a non-EU controller is covered when *offering* services to people in the EU (Art. 3(2)), and mere accessibility isn't enough (Recital 23). With English only, no EU targeting and closed, invite-only sign-up, probably not; inviting EU friends makes it greyer [LEGAL: decide; if yes, also the Art. 27 representative question and the EU age of consent, 13-16 by country] | Rights offered to everyone; the processors and transfers (US providers) listed plainly |
| CAN-SPAM | Only for commercial email. Alert emails (later, via SES) are transactional/relationship messages | Every alert email carries an unsubscribe/disable link anyway |

**Pre-publication review checklist** `[LEGAL]`:
1. Whether a free, non-monetized site counts as "commercial" for CalOPPA.
2. The GDPR Art. 3(2) position given invite-only EU users.
3. The operator's state's breach-notification statute (the notes are private).
4. The Texas/Nebraska small-business exemption for an individual.
5. The age wording (13 US; the EU age of consent if GDPR is in scope).
6. That the page names the controller by name, state and country, plus the privacy@ contact,
   with no street address.
7. The terms' liability limits. There's no governing-law or venue clause (owner decision: no
   location published); confirm that's acceptable.
8. The game EULA and FRM items from LEGAL.md. Roadmap 2b: must be **live before ADR-0025 gate B** (the Google
consent screen requires a privacy policy URL, and gate B starts storing emails). The frontend page
comes later. `[OWNER]` = the owner decides; `[LEGAL]` = get legal review before publishing;
`[BUILD]` = the policy promises something the code doesn't do yet (a prerequisite, not text).

## A. Privacy policy

1. **Who runs this.** The controller's identity and a postal or contact address as required by
   the applicable law. `[OWNER][LEGAL]`: the legal name vs a trading name, and the country
   (which decides GDPR/UK GDPR and others). The workspace rule keeps personal data out of repos,
   so this text lives only on the published page, decided by the owner.
   Contact: `privacy@satis-manager.com`. The terms refer to "the operator named in the privacy
   policy" and never repeat the name.
2. **What we collect, and why** (from ADR-0025/0027 and the code):
   | Data | Why | Basis (if GDPR applies) `[LEGAL]` |
   |---|---|---|
   | Google account id (`sub`) and verified email | sign-in; linking invites | contract |
   | Display name (chosen, or from the email) | shown to people you share a server with | contract |
   | Session records (a hashed id, times) | keeping you signed in; "sign out everywhere" | contract |
   | Server names, memberships, roles | sharing and permissions | contract |
   | Game telemetry (power, production, machine states, building positions) | the dashboard, history, alerts. About the game world, not you | contract |
   | Discord webhook URL (encrypted); later, alert email addresses | delivering alerts you set up | contract / consent (email) |
   | In-game names of players connected to a server you're a member of (ADR-0029) | shown live to that server's members only; **not stored and not logged**. They come from the server owner's own game server, and the server owner is responsible for telling their players | legitimate interest |
   | Audit events (who did what to which server, when; **no emails or names in them**) | security and abuse investigation | legitimate interest |
   | IP address | rate limiting (in memory) and security logs on sign-in events | legitimate interest |
3. **What we don't do:** no ads (ADR-0021), no analytics or tracking scripts (none in the code
   today), no selling or sharing of data for marketing. **Cookies:** only strictly necessary ones
   (the session cookie and a 10-minute sign-in cookie), so no consent banner `[LEGAL: confirm for
   the target countries]`.
4. **Who else processes data (processors / third parties):**
   - Google (sign-in: you share your email and id with us)
   - Cloudflare (hosting, DNS, the tunnel and firewall: sees every request's IP and metadata)
   - Amazon Web Services (encrypted backups in S3; later, email via SES)
   - Discord (only if you configure a webhook: alert text is posted under Discord's terms)
   `[LEGAL]` transfers outside the owner's country (US providers) and whether a DPA / terms
   acceptance is needed per provider.
5. **Retention.** The first four rows are already decided; the rest need a decision:
   - Account data: until you delete your account.
   - Sign-in attempts: 10 minutes. Sessions: 8 hours active, records purged after 30 days
     `[BUILD: purge job]`.
   - Telemetry: raw 48 h, per-minute rollups 30 days, hourly rollups 1 year (ADR-0027, pending
     the owner's decision).
   - Backups: encrypted, 30 days, so deleted data can survive in backups for up to 30 days
     (ADR-0025).
   - Audit events: 1 year (owner decision).
   - Server logs (including IPs on sign-in events): 14 days (owner decision).
     `[BUILD: log rotation/retention doesn't exist yet]`
6. **Your rights:** access/export, correction, deletion, objection, complaint to a supervisory
   authority `[LEGAL: which authority and rights apply]`.
   - Deletion: self-service in the account menu `[BUILD: before sharing (1b)]`, and meanwhile by
     email. Deleting an account removes the user, identities, sessions and memberships
     (cascade); servers you own are transferred or deleted first (ADR-0025 note).
   - Export: `[BUILD]` a JSON export, or by email request until then.
7. **Security (in plain words):** Google sign-in (no passwords stored), hashed session ids,
   encrypted backups and webhook secrets, least-privilege database roles, a strict Content
   Security Policy, and the API reachable only through Cloudflare. No guarantees, but best efforts.
8. **Children:** not directed at children; minimum age 13 (COPPA). An account is deleted on
   learning its user is under 13 `[LEGAL: the EU age wording if GDPR is in scope]`.
8b. **Do Not Track (CalOPPA):** we don't track users across sites or allow third-party tracking,
   so DNT signals change nothing. **Breach notice:** affected users are told without undue delay.
9. **Changes:** the "last updated" date; notice on the site for material changes.

## B. Terms of use (outline)
1. **The service:** a free dashboard for your own Satisfactory dedicated server, provided **as is**,
   with no uptime or accuracy guarantee (it depends on your server and third-party mods).
2. **Eligibility and accounts:** a Google account; one person per account; keep access to your
   Google account secure.
3. **Your servers:** only connect servers you have the right to administer. You're responsible
   for the tokens you configure. Invitations: you choose who sees your server.
4. **Acceptable use:** no attacking, overloading, scraping, or probing the service beyond
   responsible disclosure (a security contact goes on the page); no using alerts to spam
   third-party channels.
5. **Third-party games and mods:** **not affiliated with or endorsed by Coffee Stain Studios.
   Satisfactory is their trademark.** The Ficsit Remote Monitoring mod is a separate project
   under its own license. `[LEGAL]` LEGAL.md's open items (the game EULA / Content Usage
   Guidelines and FRM's actual license) must be resolved before any paid tier, and should be
   reviewed before publishing even the free terms.
6. **Source code:** the code is AGPL-3.0-only (LICENSE). These terms cover the hosted service,
   not your rights under the code license.
7. **Suspension and termination:** you can delete your account at any time; the operator may
   suspend accounts that break these terms, or shut the service down with notice where practical.
8. **Liability:** limited to the extent the law allows `[LEGAL]`; no liability for game-server
   outages or missed alerts. **Alerts are best effort and run only while the operator's machine
   is up** (ADR-0027).
9. **Governing law and disputes:** no clause (owner decision 2026-09-24: no location is
   published); the default rules apply `[LEGAL]`.
10. **Changes** and **contact.**

## C. Prerequisites before publishing (so the policy is true on day one)
1. `[BUILD]` Log retention: rotate backend logs and keep 14 days (the dev plus reactapps-dc for
   the scheduled task). Replace the username with the user id in sign-in logs once ADR-0025
   PR 5 lands.
2. `[BUILD]` Purge jobs: expired sessions after 30 days, stale login attempts (ADR-0025 PR 5/7).
3. `[BUILD]` Account deletion (before 1b) and an export-by-request process.
4. Owner answers are complete (controller name, contact, retention; no location published).
5. `[LEGAL]` A review of both documents, the cookie statement, international transfers, and the
   game/mod items.
6. Frontend: two **static HTML files**, `frontend/public/privacy.html` and
   `frontend/public/terms.html`, served at `/privacy` and `/terms` by Workers static assets
   [NEEDS VERIFICATION: the extensionless URL under the default html_handling]. No JavaScript,
   so they work without the SPA and can be crawled for the Google consent screen. The strict CSP
   applies: styles come from a static CSS file, nothing inline. Linked from the footer and the
   sign-in page. The owner's name appears in `privacy.html` only; reactapps-dc narrows the CI
   PII-scan exclusion to exactly that path.

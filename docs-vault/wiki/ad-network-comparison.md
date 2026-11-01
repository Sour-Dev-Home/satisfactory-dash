# Ad network comparison (ADR-0021 amendment, build step 1)

Which ad network fits the owner's 2026-10-27 constraints ([ADR-0021](./decisions/0021-advertising.md), "Amendment,
2026-10-27"): contextual ads with **no cookies and no personal profiling, so no consent banner**; in the signed-in app,
shown **inside a sandboxed iframe served from our own separate origin** (e.g. `ads.satis-manager.com`); also on the
public pages. The site is a free dashboard for Satisfactory dedicated-server owners, a gaming and technical audience,
with **no traffic data yet**.

Every cell cites a capture in `raw-sources/` (file, then excerpt number). "Not stated" means the network's captured pages
say nothing on it; it is [NEEDS VERIFICATION], not a guess. Captured 2026-10-27; the ad networks' terms change, so
re-check before the owner confirms.

Captures: EA = [`ad-network-ethicalads-2026-10-27.md`](../raw-sources/ad-network-ethicalads-2026-10-27.md),
CA = [`ad-network-carbon-2026-10-27.md`](../raw-sources/ad-network-carbon-2026-10-27.md),
AS = [`ad-network-adsense-2026-10-27.md`](../raw-sources/ad-network-adsense-2026-10-27.md),
VE = [`ad-network-venatus-2026-10-27.md`](../raw-sources/ad-network-venatus-2026-10-27.md).
AdSense and Venatus are contrasts (what the privacy-first rule excludes), not candidates.

## Table

| Criterion | EthicalAds | Carbon Ads (BuySellAds) | Google AdSense (contrast) | Venatus (contrast) |
|---|---|---|---|---|
| Traffic minimum | 50,000 pageviews/month; occasional exceptions for fast-growing sites (EA E1, E2) | No number; "monthly page views" is one criterion (CA E1) | None stated; 18+, own site, original content (AS E5) | Not stated (VE, NOT FOUND) |
| Topic / audience | "developer-focused sites" only; gaming not mentioned (EA E2, E3) | "English-speaking developers and designers", "tech and design voices"; gaming not mentioned (CA E2, E4) | Any compliant content (AS E5) | Gaming is its core (VE E1, site menu) |
| Approval | Invite-only; application, then a review of the ad display before paid ads (EA E3, E5) | Invitation only; application with URL and traffic stats, 5-7 business days (CA E1) | Application against program policies (AS E5) | Not stated |
| Geography | Paid ads mainly North America and Western Europe (EA E4) | Mainly US, Canada, Europe (CA E2) | Not limited (AS) | Not stated |
| Cookies / storage | No identifying cookie unless you log in to EthicalAds; no identifiers in local storage; IP used in real time, logs kept 10 days (EA E6, E7) | **Conflicting:** "No cookies" (CA E4) vs ad-serving cookie "unique to the specific computer" (CA E5) | Cookies or ad identifiers even for non-personalised ads; limited ads still use cookies and local storage for invalid-traffic detection (AS E1, E2) | IAB TCF vendor; built-in CMP; device IDs via cookies (VE E2, E3) |
| No-banner claim | "GDPR-compliant, beautiful ads. Not cookie banners." (marketing line, not a legal opinion) (EA E3) | None found (CA) | No: consent required in UK, Switzerland, EEA (AS E1) | No: ships a CMP (VE E2) |
| Iframe on our origin | Not stated [NEEDS VERIFICATION]; client sends the iframe page's URL, keywords can be set by hand (EA E9, E10) | Not stated [NEEDS VERIFICATION]; code unmodified, not self-hosted, once per page (CA E6) | Only rule found: no iframes with keywords to change ads (AS E4) | Not stated |
| Login-protected pages | Not stated; crawler cannot see them, keywords API is the documented way round (EA E10) | BSA terms forbid "Materials that contain restricted or password only access pages" (scope of "Materials" unclear) (CA E7) | May disable ads on password-protected content Google cannot crawl (AS E3) | Not stated |
| Placement rules | Only ad on the page; above the fold (or off on mobile); not within content; 0.1% CTR (EA E5) | Exclusive network; above the fold at 1366x768; within 3 viewports on mobile (or off); 0.07% CTR target; 14 days idle pauses (CA E3, E6) | No new-window or altered click behaviour (AS E3) | Not stated |
| Pay model | Mix of CPC and CPM; about $2.50 per 1,000 pageviews (EU/NA) (EA E4) | Typical $1.20-$2.30 CPM, not guaranteed (CA E2) | 80% of revenue after buy-side fee (about 68% via Google Ads), eCPM (AS E6) | Not stated |
| Revenue share | 70% (EA E5) | Not stated | 80% / about 68% (AS E6) | Not stated |
| Minimum payout | $50, monthly (EA E5) | $1, then PayPal $20, check $50, wire $500 + $35; within 30-60 days (CA E2) | Threshold amount not captured [NEEDS VERIFICATION] (AS) | Not stated |
| Payment methods | Stripe Connect, PayPal, OpenCollective, GitHub Sponsors (EA E5) | PayPal, check, wire, Open Collective (quarterly) (CA E2) | Not captured | Not stated |
| Content / IP rules | Must not violate copyright or trademark law (EA E12) | Acceptable-use list (CA E7); warranty of non-infringement (CA, FINDINGS) | Content that "infringes copyright" not allowed; DMCA notices (AS E7) | Not stated |
| Tag hosts for CSP | Script `media.ethicalads.io`; JSONP script and pixels `server.ethicalads.io`; inline styles; image host not stated (EA E9, E11) | Not stated [NEEDS VERIFICATION] (CA) | Not captured; many Google domains (AS) | Not stated |
| Static page can host it | Yes: one `<div>` plus one async script (EA E11) | Likely (dashboard code, client component) but not stated (CA E6) | Not assessed | Not assessed |

## What the table means for the ADR-0021 design

- **Above the fold and "only ad on the page".** Both candidates want the ad visible on first load (EA E5, CA E6) and no
  other ad on the page. ADR-0021 decision 4 puts app slots "below the page content" on Overview, Power and Factory, which
  would likely fail that rule; the Planner and Map side area is the placement that fits. One slot per page in the app.
- **Iframe from our origin.** Neither network says yes or no. With EthicalAds the ad request carries the iframe page's
  URL (EA E9), so the network sees `ads.satis-manager.com/...`, not the app; content targeting then has to come from
  hand-set keywords on that page (EA E10). This must be put to the network in the application, in writing.
- **Sandbox.** EthicalAds' client runs as script inside the iframe and loads a JSONP `<script>` and `<img>` pixels
  (EA E9), so the frame needs `allow-scripts`, and clicks opening a new tab need popups allowed; the iframe's own
  CSP needs `script-src media.ethicalads.io server.ethicalads.io`, `img-src` for the pixels and ad images, and inline
  styles (EA E9). The app's own CSP is unchanged apart from `frame-src` (ADR-0021 decision 2). Build step 2 settles it.

## Recommendation

**EthicalAds** is the best fit for the owner's constraints. It is the only candidate whose own privacy policy says
both no identifying cookie for ad viewers and no identifiers in local storage (EA E7), with country-only geo-targeting
and short IP log retention (EA E6); its client is open source and small enough to host on a static ad-origin page
(EA E9, E11); it pays a published 70% share with a $50 minimum (EA E5). Carbon is second: its own pages contradict
each other on cookies (CA E4 vs E5), it publishes no CSP hosts and no revenue share, and the BuySellAds terms carry a
clause on "password only access pages" (CA E7) that could cover the signed-in app. AdSense and Venatus fail ADR-0021
decision 5 by their own documentation (AS E1, E2; VE E2, E3).

**Main risk: acceptance.** EthicalAds asks for 50,000 pageviews a month from developer-focused sites and is invite-only
(EA E1-E3); this site has no traffic data, and a game-server dashboard is technical but not plainly "developer". The
exception for "growing quickly" sites (EA E1) is the only path at launch. Carbon has the same audience framing without a
number (CA E1, E2). If neither accepts the site, ADR-0021 decision 5 already says the owner decides again; nothing in
these captures supports falling back to a cookie-based network without a banner.

Open before the owner confirms (ask EthicalAds, then Carbon, in the application):
1. Is a game-server dashboard with launch-level traffic accepted, or eligible for the growth exception?
   [NEEDS VERIFICATION]
2. Is serving the ad from a static page on our own subdomain, inside a sandboxed iframe in a signed-in app, allowed?
   [NEEDS VERIFICATION]
3. Does the ad-decision response set any cookie (EthicalAds' "generally" in EA E7; Carbon's E5)? Check by a network
   capture of the ad origin once built. [NEEDS VERIFICATION]
4. The ad-image host for `img-src`. [NEEDS VERIFICATION]

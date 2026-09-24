# ADR-0021: Advertising: none on the dashboard; optional ads only on public content pages

Status: accepted (project owner), 2026-09-24: no ads now; the path for later is reserved as below

## Context
The owner asked whether the site can run ads. Relevant facts:
- **Authenticated pages** show users' private server data (ADR-0011). AdSense serves ads behind
  a login only if the publisher gives Google's ads crawler a login (AdSense help "Display ads on
  login-protected pages"). That would expose users' private data to a third party.
- **AdSense bans ads on screens without publisher content**, including login, error and
  "thank you" screens (Google Publisher Policies).
- **Personalized ads to EEA/UK/Swiss visitors** require a Google-certified CMP integrated with
  IAB TCF (AdSense help 13554116): a consent banner.
- **Security headers:** the site's CSP allows scripts from 'self' only (ADR-0016/0018). Ad scripts
  are third-party, change constantly, and are a known malvertising and XSS surface. ADR-0016
  item 8 says script-src never loosens.
- **Revenue at ≤5,000 users** would likely be small [NEEDS VERIFICATION: no traffic data
  yet]. Paid managed hosting (ADR-0014) is the planned revenue.
- **Using game content next to ads** is commercial use, which touches the open Coffee Stain
  EULA/Content Usage Guidelines item in LEGAL.md.

## Decision
- **No ads on any authenticated page** (the dashboard, settings, map) and no ad scripts in the SPA
  bundle. The app's CSP stays strict.
- **If ads are wanted:** only on separate, public content pages (landing page, guides, changelog),
  built as static pages outside the SPA with their own path-scoped CSP in `_headers`, using a
  certified CMP for EEA/UK/CH. That's its own PR, reviewed by security-reviewer.
- **Room reserved now (cheap):** when the app shell and router land (ADR-0016 step 4), the
  authenticated app lives under `/app/*`. `/` and future public paths (`/guides/*`,
  `/changelog`) stay free for static public pages, which can later get their own path-scoped
  `_headers` CSP without touching the app's. Deep links and the SPA fallback are scoped to
  `/app/*` accordingly.
- **Prefer non-ad revenue first:** managed hosting (ADR-0014) and optionally a donation link
  (no scripts, just a link).

## Consequences
- User data never reaches an ad network, and the dashboard's security model is unchanged.
- Ads, if added later, carry their own consent and CSP cost, isolated from the app.

## Revisit when
- Public content pages exist with real traffic numbers, or the owner decides the LEGAL.md items
  allow commercial use next to game content.

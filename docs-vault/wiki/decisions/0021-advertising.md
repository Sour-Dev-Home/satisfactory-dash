# ADR-0021: Advertising: none on the dashboard; optional ads only on public content pages

Status: accepted (project owner), 2026-09-24: no ads now; the path for later is reserved as below. **Amended 2026-10-27
(owner): ads at release, privacy-first and isolated, on public pages and in fixed slots in the app; see "Amendment,
2026-10-27" at the end, which overrides the Decision below where they differ.** **Amended again 2026-10-27 (owner):
AdSense with a consent banner, in the app via a crawler account; see "Amendment 2" at the end, which overrides
amendment 1 where they differ (its network pick, Decision 2 and Decision 5).**

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

## Amendment, 2026-10-27: ads at release, privacy-first and isolated

### Owner's decisions (2026-10-27)
- Verbatim: "Accept the risk based on their inaction against similar mods and services that are monetized like
  satisfactory calculator. Donations are not very effective. Amend the adr on ad ban". This is the owner deciding the
  LEGAL.md EULA item for monetization (the second "Revisit when" trigger above): the risk is **accepted, not resolved**.
  The EULA text is still unread [NEEDS VERIFICATION]; Coffee Stain's apparent tolerance of monetized tools is evidence of
  practice, not permission (LEGAL.md "Satisfactory's own EULA / IP").
- Placement (owner's pick, the recommended option): **public pages plus fixed slots in the signed-in app, isolated**.
- Network (owner's pick, the recommended option): **privacy-first, no tracking**: contextual ads with no cookies and no
  personal profiling (EthicalAds- or Carbon-style). Which network, and whether it accepts this site, is
  [NEEDS VERIFICATION] and settled in build step 1.

### Decision (replaces "Decision" above where they differ)
1. **Ads run at release** on the public pages (`/`, and `/guides/*` and `/changelog` once they exist) and in a small,
   fixed set of slots in the app (`/app/*`).
2. **Isolation in the app: an iframe, never a script.** An app slot is a sandboxed `<iframe>` whose page is served from a
   separate origin we control (e.g. `ads.satis-manager.com`, a static page that loads the network's tag). The app's CSP
   adds only that origin to `frame-src`; **`script-src` stays `'self'`** (ADR-0016 item 8 holds) and no ad code is in the
   SPA bundle. The iframe gets `sandbox` with the fewest allowances the network needs (no `allow-same-origin` with our
   origin, no `allow-top-navigation`; clicks open a new tab), `referrerpolicy="no-referrer"` and a fixed size.
3. **No user data reaches the network.** The iframe's URL carries no server, user, factory or game data; the ad page
   gets at most a fixed placement name. Contextual targeting is by the site's topic, not by what a user's dashboard shows.
   The first paragraph of "Consequences" above still holds.
4. **Where slots may go:** a fixed-height slot reserved in the layout (so it never shifts content: ADR-0032's layout
   budget), outside every canvas, table and panel of game data: e.g. below the page content on Overview, Power and
   Factory, and in the Planner and Map pages' side area, never over the graph or the map. Never on login, error,
   pairing, account or settings screens, and never in a modal. A failed or blocked ad leaves the reserved space empty
   with no error and no retry loop.
5. **Privacy-first means no consent banner.** A network that sets no cookies and builds no profile needs none
   [NEEDS VERIFICATION per network, with its documentation saved to `raw-sources/`]. If the chosen network sets any
   cookie or identifier, this amendment's "no banner" no longer holds and the owner decides again before it ships.
6. **Public pages** follow the original Decision's path-scoped CSP for `/` and the content pages; the same network,
   loaded in the same isolated way or directly on those static pages (they hold no user data).
7. **Off switch.** One build-time flag removes every slot (no request to the ad origin) for a takedown request, a network
   problem or a security issue, without touching the app.

### What changes elsewhere (in the build PRs, not here)
- **Privacy page and terms** (`frontend/public/privacy.html`, terms): "no ads" becomes what the ads are and are not
  (contextual, no tracking, the network's name and its privacy link). The page's "no analytics or tracking scripts" stays
  true for the app itself.
- **Game assets notices:** `frontend/public/game-assets/NOTICE.md`, the map terrain NOTICE and LEGAL.md describe the icons
  and terrain as used in a "free, non-commercial tool". With ads that wording is no longer accurate; it changes to fan
  content in a free-to-use, ad-supported tool, removed on request.
- **LEGAL.md** records the owner's risk acceptance (this PR).
- **Security:** `security-reviewer` reviews the iframe origin, the sandbox and CSP changes; `e2e` keeps failing on any
  CSP violation, so the ad origin is allowed in `frame-src` only.

### Build plan (each PR from `main`, no stacking)
| # | PR | Proof |
|---|---|---|
| 1 | Pick the network: save its terms, privacy and cookie documentation to `raw-sources/`, check it accepts the site | Owner confirms the network |
| 2 | Ad origin: a static page on its own hostname, its own CSP, no access to the app's origin | `security-reviewer`; headers test |
| 3 | `AdSlot` component (iframe, sandbox, fixed size, reserved space, empty on failure) behind the off switch, slots placed per Decision 4; app CSP `frame-src` | e2e: no CSP violation, no layout shift, axe; screenshots; `ui-reviewer` |
| 4 | Public pages' slots and path-scoped CSP | e2e on `/` |
| 5 | Privacy page, terms, NOTICE and LEGAL.md wording | Owner reviews the text |

### Consequences of the amendment
- The site earns from ads from release, at a privacy-first network's lower rate, without a consent banner and without
  loosening the app's script policy.
- The legal risk of commercial use next to Coffee Stain's icons and map is the owner's accepted risk. A takedown request
  is answered with the off switch (ads) or by removing the assets, as LEGAL.md already promises.
- An iframe ad is still third-party content in the page: a misbehaving creative can at worst show something unwanted in
  its box or open a tab; the sandbox keeps it from scripting the app.

### Revisit when
- Coffee Stain publishes terms, or contacts the project, about commercial use.
- The chosen network starts setting cookies or identifiers (Decision 5).
- Revenue data shows the slots are not worth their space, or a richer network is wanted (a consent banner decision).

## Amendment 2, 2026-10-27 (later the same day): AdSense with a consent banner, in the app via a crawler account

### Why it changed
The network research (build step 1, [`ad-network-comparison.md`](../ad-network-comparison.md)) found that both privacy-first
networks are invite-only and developer-focused, and EthicalAds asks for about 50,000 pageviews a month (EA E1-E3, CA E1-E2
there). This site has no traffic data, so neither is likely to accept it at launch. AdSense states no traffic minimum
([`ad-network-adsense-2026-10-27.md`](../../raw-sources/ad-network-adsense-2026-10-27.md) E5), but sets cookies even for
non-personalised ads (E1).

### Owner's decisions (2026-10-27), verbatim picks
- (a) **"AdSense with a consent banner"**. This **reverses** amendment 1's network pick ("privacy-first, no tracking") and its
  Decision 5 ("no consent banner").
- (b) **"Also in the app, via a crawler account"**. The AdSense script runs in the signed-in app, and Google's crawler gets a
  login that sees only a demo-like server.

### Decision (replaces amendment 1 where they differ)
1. **Consent.** EEA, UK and Swiss visitors get a consent banner from Google's own CMP ("Privacy & messaging", formerly Funding
   Choices). AdSense requires a Google-certified CMP integrated with IAB TCF for these visitors (AdSense help 13554116, cited in
   this ADR's Context; that page is not in the capture). Whether Google's own CMP meets that for this site is
   [NEEDS VERIFICATION] and settled in build step 1.
2. **Ads load only after consent where consent is required.** Elsewhere the site follows the capture: cookies for frequency
   capping and reporting need consent where the law requires it (E1), and limited ads still use invalid-traffic cookies and
   local storage, with the EU user consent policy still applying (E2). Whether limited ads are turned on is decided in build
   step 2 from those rules.
3. **In the app, the script runs in the app page itself.** AdSense needs the real page to evaluate content (E3), so the
   iframe isolation of amendment 1 Decision 2 is **reversed**, and so is ADR-0016 item 8 for `script-src`: the app's CSP
   allows Google's ad domains. **This is a security posture change, made by the owner.** The domain list is
   [NEEDS VERIFICATION] and captured in build step 1. `security-reviewer` is required on every PR that changes the CSP or
   loads the script. Ad code is still not bundled; it loads from Google at runtime behind the off switch. Clicks are left to
   Google's code (E3 bans altering them).
4. **What Google's script can see.** A third-party script in the page can read the page: in the app that includes server,
   factory and player names and anything else on screen. Amendment 1 Decision 3 ("no user data reaches the network") and
   the first paragraph of the original Consequences **no longer hold for the app**. The privacy page must say so plainly.
5. **Crawler account.** A dedicated account with the viewer role, attached only to a demo-data server: the demo world of
   ADR-0026 served through the real API, or a fixed fake server [NEEDS VERIFICATION: ADR-0026's demo is frontend-only and
   never reaches the API, so which one is decided in build step 3]. Its credentials go into AdSense's "login-protected pages"
   setting. It never sees real user data. Its secret lives only in the owner's AdSense settings and in SSM, never in the repo.
6. **Slots.** Amendment 1 Decision 4 stays: fixed reserved space, never over game data, never on login, error, pairing,
   account or settings screens, never in a modal, empty on failure. AdSense also bans ads on screens without publisher
   content (this ADR's Context). AdSense's own limits on the number and placement of ads also apply [NEEDS VERIFICATION].
7. **The off switch stays** (amendment 1 Decision 7): it removes the script, the CMP and every slot.
8. **Intellectual property.** Google's policies forbid content that "infringes copyright", handled by DMCA notices (E7).
   Coffee Stain's icons and map next to ads are a risk under that policy as well as the EULA one. It is the owner's accepted
   risk, and it could cost the AdSense account, not just a takedown of the assets.

### What changes elsewhere (in the build PRs, not here)
- **Privacy page and terms** are rewritten: cookies and local storage, Google's role (processor or controller
  [NEEDS VERIFICATION]), consent and how to withdraw it, opting out, and what Google's script can read (Decision 4). The
  privacy page's "no analytics or tracking scripts" no longer holds once ads ship.
- **LEGAL.md's privacy section** changes to match.
- **NOTICE wording** for the game assets changes as amendment 1 already planned.

### Build plan (replaces amendment 1's; each PR from `main`, no stacking)
| # | PR | Proof |
|---|---|---|
| 1 | Capture the AdSense CSP domains and the CMP setup docs to `raw-sources/` | The captures; owner confirms the account |
| 2 | CMP and consent gate: no ad request before consent where required | e2e: no ad request without consent (EEA simulated); `security-reviewer` |
| 3 | Crawler account and demo-data server; secret in SSM | `security-reviewer`; the account sees no real server |
| 4 | Slots per Decision 6, the CSP change, the off switch | `security-reviewer`; e2e: no CSP violation, no layout shift, axe; `ui-reviewer` |
| 5 | Public pages' slots and their path-scoped CSP | e2e on `/` |
| 6 | Privacy page, terms, NOTICE and LEGAL.md wording | Owner reviews the text |

### Consequences of amendment 2
- Ads can run from launch (no traffic minimum, E5), at the cost of a consent banner, a looser app CSP and a third party that
  can read what users see.
- The crawler account is one more credential to guard and rotate.
- The AdSense account itself becomes a single point of failure for the revenue (Decision 8).

### Revisit when
- An invite-only privacy-first network accepts the site: move back to amendment 1's privacy-first design.
- AdSense rejects the site, limits its ad serving, or disables the account.

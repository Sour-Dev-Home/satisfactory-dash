# ADR-0021: Advertising: none on the dashboard; optional ads only on public content pages

Status: accepted (project owner), 2026-09-24: no ads now; the path for later is reserved as below. **Amended 2026-10-27
(owner): ads at release, privacy-first and isolated, on public pages and in fixed slots in the app; see "Amendment,
2026-10-27" at the end, which overrides the Decision below where they differ.** **Amended again 2026-10-27 (owner):
AdSense with a consent banner, in the app via a crawler account; see "Amendment 2" at the end, which overrides
amendment 1 where they differ (its network pick, Decision 2 and Decision 5).** **Amended a third time 2026-11-01
(owner): Google's strict CSP via a Worker nonce, in the app and on public pages, and limited ads on; see "Amendment 3"
at the end, which overrides amendment 2's Decisions 2 and 3 and its build plan.**

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

### Note, 2026-11-01: the account exists; the site is verified by meta tag
The owner created the AdSense account and gave its publisher id (`ca-pub-2932631210238768`, public by design: it is on
every page that shows its ads). This confirms the account half of build step 1. The site is verified by AdSense's "Meta
tag" method, not its code snippet: `frontend/index.html` carries `<meta name="google-adsense-account">`, and
`public/ads.txt` names Google as a direct seller for the same publisher. Neither loads anything or sets a cookie, so the
CSP and Decision 2 (no ad request before consent) are untouched. The snippet arrives with build step 2's consent gate and
step 4's CSP change. `e2e/build-output.spec.ts` checks that the tag and ads.txt name the same publisher and that no
AdSense script ships before then. The doc captures of build step 1 are still to come.

### Note, 2026-11-01: build step 1 is complete; the captures contradict Decision 3's domain list
[`adsense-csp-and-cmp-2026-11-01.md`](../../raw-sources/adsense-csp-and-cmp-2026-11-01.md) captures Google's CSP, CMP,
limited-ads, crawler-login and placement pages, so build step 1 is complete. No decision changes here; the owner decides
what follows from the contradictions below.

Resolved [NEEDS VERIFICATION] items:
- **Decision 1 (is Google's CMP enough):** yes. The Privacy & messaging European regulations message is a Google-certified
  TCF CMP ("Google LLC CMP", ID 300; E3, E4). It is turned on by picking Google's CMP at site review, which creates the
  message automatically, or by publishing one in Privacy & messaging (E5, E6). It needs a referrer policy that sends the
  Referer cross-origin; the current `strict-origin-when-cross-origin` qualifies (E6). Withdrawal is AdSense's automatic
  revocation link or `googlefc.callbackQueue.push(googlefc.showRevocationMessage)` (E7, E10). A US state regulations
  opt-out message ("Do Not Sell or Share", IAB GPP) also exists (E12).
- **Decision 6 (AdSense's own limits):** no numeric per-page limit. Ads must not exceed publisher content, never appear on
  screens without content or used for alerts or navigation, or on error or other dead-end screens; labels are only
  "Advertisements" or "Sponsored Links"; take care near navigation and game windows; no ads in desktop applications (so
  never in the edge agent) (E16-E18). These agree with Decision 6.
- **Decision 2 inputs (limited ads):** limited ads are **on by default**; they serve when there is no Purpose 1 consent and
  use invalid-traffic-only cookies, local storage and Shared Storage without consent, which Google leaves to the
  publisher's legal judgement; they can be turned off under Brand Safety > Blocking controls > Ad serving (E8, E13).

Contradictions and new constraints (for the owner):
- **Decision 3 contradicts the capture.** Decision 3 plans an app CSP that "allows Google's ad domains". Google supports
  **no domain allowlist**: only a strict CSP with a per-response nonce, `'strict-dynamic'`, `'unsafe-eval'` and `https:`
  fallbacks, and "more restrictive policies may break without notice" (E1, E2). Its example sets no `default-src`, so
  frames, images and fetches are unrestricted in it. The site's CSP today is a static `_headers` file, which cannot carry a
  per-response nonce. Whether a hash-based strict CSP works is not documented.
- **Decision 2 and build step 2's proof ("no ad request before consent").** Google's CMP is deployed by the AdSense tag
  itself (E5-E7), so `adsbygoogle.js` must load before the user chooses; ad requests can be held with `pauseAdRequests=1`,
  during which "various scripts are still loaded" (E9). Google also says not to call its ad tag without Purpose 1 consent,
  while its own table serves limited ads without it (E8). With limited ads on (the default), ads are requested without
  consent. Build step 2 must choose between these.
- **Decision 5 (crawler account).** The crawler login is available only after the account is activated, needs Search
  Console verification, and takes a login URL plus GET or POST parameters that make the server "return a cookie" (E15).
  Whether the app's password login (a JSON POST to the API origin, not the app origin) fits that form is
  [NEEDS VERIFICATION] in build step 3.

Still [NEEDS VERIFICATION]: frame/img/connect hosts (not documented, and unsupported by E1); the CMP script's origin; a
hash-based strict CSP; whether Google's CMP holds ad requests until a choice by itself; Google's processor or controller
role; which CMP option the owner picked when requesting the review.

## Amendment 3, 2026-11-01: Google's strict CSP in the app and on public pages; limited ads on

The build step 1 captures ([`adsense-csp-and-cmp-2026-11-01.md`](../../raw-sources/adsense-csp-and-cmp-2026-11-01.md))
contradicted amendment 2's Decisions 2 and 3 (see the note above). The owner chose in this session, 2026-11-01:

### Owner's decisions, verbatim picks
- "Public pages and the app": ads on the public pages and in the app as amendment 2 planned, with the app's script policy
  loosened to the one Google supports (eval allowed, any https script, a per-response nonce via a Cloudflare Worker), over
  "public pages first" and "hold ads for now".
- "Keep them on": limited ads stay on, so visitors who decline still see limited ads, over turning them off.
- On which consent option was picked at the AdSense review request: "Not sure". The owner checks Privacy & messaging.

### Decision (replaces amendment 2 where they differ)
1. **CSP (replaces amendment 2 Decision 3's domain list).** Wherever the ad script can load, the page's `script-src` is
   Google's supported strict policy: `'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:`, with
   `object-src 'none'` and `base-uri 'none'` (E1, E2). Browsers that support `'strict-dynamic'` ignore the host and
   `'unsafe-inline'` parts, so in them only nonced scripts and the scripts those load run. **This is a security posture
   change, made by the owner:** a third-party script with `eval` runs in the same page as users' server data (amendment 2
   Decision 4 already said it can read the page). The other directives (`connect-src`, `img-src`, `frame-src`, ...) are set
   in build step 4. They start from today's `_headers` plus what the ads need, are proven in e2e and staging, and are
   reviewed by `security-reviewer`. Google warns that policies tighter than its own "may break without notice" (E1), so
   one that breaks is loosened, not worked around.
2. **A Worker sets the nonce.** `_headers` is static and cannot carry a per-response nonce, so a Cloudflare Worker runs
   first for HTML responses. It makes a nonce, writes it into every `<script>` tag (HTMLRewriter) and sends the CSP.
   Assets stay static. The Worker is part of the frontend deploy (ADR-0013 amendment) and lives in the repo, with tests.
3. **The off switch restores the strict policy.** With ads off, the Worker sends today's `script-src 'self'` policy and
   no ad script, CMP or slot is served. Off is the default until build step 4 ships.
4. **Limited ads on (replaces amendment 2 Decision 2).** Where consent is required, no *personalised* ad and no
   non-essential cookie is used before consent. Limited ads, which use invalid-traffic cookies and local storage, may
   serve without it, as Google designs them (E8, E13). The legal judgement Google leaves to the publisher (E13) is the
   owner's, and the privacy page says plainly that limited ads load before a choice. AdSense's tag deploys the consent
   message itself (E5-E7), so the script loads before the choice; the code does not hold ad requests back.
5. **Consent messages are configured in AdSense, not built.** The owner publishes Google's European regulations message
   and, if wanted, the US state regulations message (E12) in Privacy & messaging. The site adds a "Privacy and cookie
   settings" link that opens the revocation message (`googlefc.showRevocationMessage`, E10), on the public pages and in the
   app's footer.
6. **The demo site (demo.satis-manager.com) is out of scope.** It is not the verified AdSense site and keeps its CSP.

### Build plan (replaces amendment 2's steps 2-6; each PR from `main`, no stacking)
| # | PR | Proof |
|---|---|---|
| 2 | Worker in front of HTML: nonce on every script, CSP per response, off switch (off), today's policy unchanged while off | Worker unit tests; e2e and `build-output.spec` still pass with no CSP change while off; `security-reviewer` |
| 3 | Crawler account and demo-data server; secret in SSM (unchanged; E15's cookie-login form is checked here) | `security-reviewer`; the account sees no real server |
| 4 | AdSense script and CMP behind the switch, the "Privacy and cookie settings" link, slots per Decision 6, the ads-on CSP | `security-reviewer`; e2e with ads on (script mocked): no CSP violation, no layout shift, axe; `ui-reviewer` |
| 5 | Public pages' slots | e2e on `/` |
| 6 | Privacy page, terms, NOTICE and LEGAL.md wording, including limited ads before a choice | Owner reviews the text |
| - | Owner: publish the consent message(s) in Privacy & messaging; turn the switch on after step 6 | AdSense shows the message live |

### Consequences of amendment 3
- With ads on, the app's script policy is far weaker than today's `'self'`. Any XSS in the app would also be easier to
  exploit, because `'strict-dynamic'` trusts whatever a nonced script loads.
- The frontend gains a Worker: one more moving part in every page load, and one more thing to test.
- Visitors who decline still get limited ads and their invalid-traffic cookies.

### Revisit when
- Google documents a hash-based or allowlist CSP: drop the Worker's nonce and tighten.
- An XSS finding or a `security-reviewer` objection lands on the ads-on policy.
- The owner's legal view on limited ads before consent changes: turn limited ads off (Brand Safety > Blocking controls >
  Ad serving, E13).

### Build note, 2026-11-01: step 2, the nonce Worker (switch off)
Cloudflare's config keys are cited to
[`cloudflare-workers-assets-worker-2026-11-01.md`](../../raw-sources/cloudflare-workers-assets-worker-2026-11-01.md)
(W-E1 to W-E7 below, to keep them apart from the AdSense capture's E numbers).
- **Routing.** `frontend/wrangler.jsonc` gains `main: ./worker/index.ts`, `assets.binding: ASSETS` and
  `assets.run_worker_first`: `/*` minus negative patterns for `/assets/*` and every static file or folder in `public/`
  (W-E1). Excluded paths are served as static assets directly, with `_headers` (W-E2); everything else (`/`, `/app/*`,
  every SPA deep link, `/privacy`, `/terms`) reaches the Worker, which forwards it to the assets binding (W-E3). An
  array turns off the navigation-request shortcut that would otherwise skip the Worker for page loads (W-E2).
  `worker/routing.test.ts` fails when a new `public/` entry is not excluded, so a static file never goes through the
  Worker by accident. The demo's `demo/wrangler.jsonc` is untouched (Decision 6).
- **The Worker** (`frontend/worker/index.ts`). For a `text/html` response it makes a 128-bit random nonce, sets it on
  every `<script>` and every script preload (`<link rel="modulepreload">`, `rel="preload" as="script"`; Vite writes
  modulepreload links, and under `'strict-dynamic'` a preload without the nonce is blocked) with HTMLRewriter (W-E6),
  and sends the security headers and the CSP. It drops the asset's `ETag` and sends `Cache-Control: private, no-cache`,
  since the body now differs per response and no shared cache may reuse a nonce. A 304 for an HTML page is asked again
  without its conditional headers, so the browser never keeps a page with an old nonce. Anything that isn't HTML (a
  redirect such as `/privacy.html` to `/privacy`, W-E5, or a 304) keeps its status, body and own headers and gets
  today's `_headers` rules, CSP included, as static serving gave it before (`security-reviewer`'s finding: without
  this, HSTS on those redirects would rest on undocumented behaviour).
- **The switch.** `vars.ADS_ENABLED` (W-E7), `"false"` in the file. Only the exact string `"true"` turns the ads-on
  policy on. Flip it in `wrangler.jsonc`, not the dashboard: Wrangler overrides dashboard vars on deploy (W-E7).
- **Off is today's policy, exactly.** Off sends `public/_headers`' CSP byte for byte. Nonces are still added while off:
  the policy names no nonce, so they do nothing, and the rewriting is proven in production before step 4 flips only
  the header. The cost while off: HTML is never answered 304 (it is small).
- **One policy.** `_headers` is not applied to responses a Worker returns (W-E4), so the Worker sends the headers
  itself from `worker/securityHeaders.ts`. `_headers` stays the source for static assets and for `vite preview` (so
  e2e is unchanged), and `worker/securityHeaders.test.ts` fails unless the module holds exactly `_headers`' `/*` rules,
  names, values and order. Whether `env.ASSETS.fetch` responses already carry `_headers` is not documented
  ([NEEDS VERIFICATION]); the Worker overwrites them either way.
- **The ads-on policy is not yet used.** It is today's policy with `script-src` replaced by E1's strict policy (a test
  compares it with the capture word for word) and `object-src 'none'`, `base-uri 'none'` kept. Its other directives,
  and E1's `report-uri`, are build step 4's.
- **Owner checks after the merge deploys:** the HTML responses carry the CSP and HSTS and the scripts a `nonce`
  (`curl -sI https://satis-manager.com/app` and view source), and the Workers plan covers one Worker request per page
  load (static files are not Worker requests).

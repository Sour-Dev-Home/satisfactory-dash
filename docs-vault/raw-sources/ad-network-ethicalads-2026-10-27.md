Source: EthicalAds' own pages, read from the public source of its website and ad client (the site at www.ethicalads.io is built from the first repository):
- Publisher FAQ, https://www.ethicalads.io/publishers/faq/ (source `content/pages/publisher-faq.md` in https://github.com/readthedocs/ethicalads.io)
- Publisher Policy, https://www.ethicalads.io/publisher-policy/ (source `content/pages/publisher-policy.md`; page says "Effective date: August 19, 2020", "Last updated: March 14, 2024")
- Privacy Policy, https://www.ethicalads.io/privacy-policy/ (source `content/pages/privacy-policy.md`; "Effective date: March 18, 2022")
- Terms of Service, https://www.ethicalads.io/terms-of-service/ (source `content/pages/terms-of-service.md`; "Effective date: December 8, 2022")
- Publishers landing page and application form, https://www.ethicalads.io/publishers/ (sources `ethicalads-theme/templates/ea/publishers.html` and `ethicalads-theme/templates/ea/includes/publishers-inbound.html`)
- Ad client docs and source, https://ethical-ad-client.readthedocs.io/ (sources `docs/index.rst` and `index.js` in https://github.com/readthedocs/ethical-ad-client, client version 2.5.0)
Captured: 2026-10-27
Method: the ethicalads.io and readthedocs-hosted pages did not resolve from the capture machine (DNS returned no address for the ad network's domains, as an ad-blocking resolver does), so the same text was read from the `main` branch of the two public GitHub repositories above with a plain HTTPS GET, and the lines below grepped and copied unedited (Markdown and HTML markup left as it is in the source; leading indentation trimmed; lines between the quoted ones left out). No account, application or sign-up. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment, build step 1 (pick a privacy-first ad network and check that it accepts the site).
FINDINGS (as the pages state them):
  - Acceptance: at least 50,000 pageviews a month, with occasional exceptions for fast-growing sites with relevant content (E1); the application form greys out the "Less than 50,000" option as "Not a fit yet" and says it wants "developer-focused sites" (E2). The network is "invite-only" (E3). Paid ads only after an initial review of the ad display (E5). Gaming is not mentioned on any captured page.
  - Geography: paid ads mainly in North America and Western Europe; elsewhere often unpaid house ads (E4).
  - Cookies and tracking: the landing page claims "GDPR-compliant ... Not cookie banners" (E3). The privacy policy says no identifying cookie unless you log in to EthicalAds, no cookie-like identifiers in local storage, no behavioural targeting; IP addresses used in real time for country-level geo-targeting and fraud prevention, logs with IP and user agent deleted after 10 days (E6, E7). It does NOT literally say "no consent banner is needed under ePrivacy"; the "Not cookie banners" line is a marketing claim, not a legal statement.
  - The policy counts "Multiple views of an ad within a short period from the same browser" as invalid (E5), so the server recognises a repeat browser somehow; with no cookie or local storage (E7) this is presumably from IP and user agent, which the pages do not say.
  - Targeting: by country (from IP) and page content; a crawler indexes the publisher's pages; SPAs and pages the crawler cannot reach can pass keywords instead (E8, E10). The client sends the page's origin plus path (no query string) with each ad request (E9).
  - Placement rules: the only ad on the page, above the fold on desktop and mobile (or ads off on mobile), beside/above/below content not within it, at least 0.1% CTR (E5).
  - Payout: a mix of CPC and CPM ads; about $2.50 per 1,000 pageviews for mostly EU/North American traffic (E4). 70% revenue share, monthly, minimum $50, via Stripe Connect, PayPal, OpenCollective or GitHub Sponsors (E5). No contract (E4).
  - Integration and CSP: one async script from `media.ethicalads.io`; ad decisions are fetched by JSONP (a `<script>` from `server.ethicalads.io`), view and view-time pixels are `<img>` loads, an ad-blocker detection pixel comes from `media.ethicalads.io`; styles are injected inline (E9, E11). A static page can host it (a `<div>` plus the script, E11).
  - Content rules for publishers: only the general acceptable-use clause (no violating copyright or trademark law) in the terms (E12).
NOT FOUND (recorded, not guessed):
  - Any rule for or against serving the ad inside an iframe, or on login-protected pages: [NEEDS VERIFICATION] (ask EthicalAds before applying; the crawler cannot see an app behind a login, which E10 says is what the keywords API is for).
  - Whether the ad-decision response from `server.ethicalads.io` sets any cookie: the policy says "generally" none (E7) [NEEDS VERIFICATION by a network capture once the ad origin exists].
  - The host that serves ad images (needed for `img-src`): [NEEDS VERIFICATION]; the client only names `media.ethicalads.io` and `server.ethicalads.io`.
  - Whether gaming or game-tool sites are accepted: [NEEDS VERIFICATION]; every captured page speaks only of developer sites.
  - Any statement on fan content using a game publisher's IP beyond the general clause in E12.

### E1 — Publisher FAQ: minimum traffic

```
## What is the minimum traffic required to join?

Your site needs at least 50,000 pageviews per month.
This helps us provide enough scale to make it worthwhile for advertisers to buy ads on your site.
If you're close, we do occasionally make exceptions for sites that are growing quickly and have high-quality, relevant content for our advertisers.
```

### E2 — Publisher application form

```
<option value="0-50k" disabled>Less than 50,000 - Not a fit yet</option>
<small class="form-text text-muted"><strong>We are looking for developer-focused sites doing 50k+ pageviews per month.</strong></small>
```

### E3 — Publishers landing page

```
<h1 class="display-3 font-weight-light" data-aos="fade-left">Developers: join the ad network without tracking</h1>
<p class="font-size-lg" data-aos="fade-left" data-aos-delay="200">Our invite-only network provides developer-focused ads based on your site content.</p>
<p class="text-gray-800 mb-6 mb-md-0">We target ads based on your site content, no tracking required. <strong>Your site deserves GDPR-compliant, beautiful ads. Not cookie banners.</strong> </p>
```

### E4 — Publisher FAQ: pay model, earnings, geography, contract

```
We sell a mix of CPC (paid per click) and CPM (paid per view) ads.
Generally, publishers see around $2.50 per 1,000 pageviews (CPM),
assuming most of your traffic is from the EU and North America.
There is no contract to sign.
You should generally see paid ads in North America and Western Europe,
which are the most targeted regions by our advertisers.
```

### E5 — Publisher Policy: review, ad display, payouts, invalid traffic

```
All publishers agree that their ad display meets these terms prior to enabling paid ads on their site.
We will do an initial review of the ad display,
- Our ad should be the only ad on the page. We currently only allow a single EthicalAds ad per page, but are discussing how to support multiple.
- The ad should appear when the user first visits, above the fold, on both desktop and mobile. You can disable the ad on mobile if this isn't possible or we can disable mobile ads for your site.
- The ad should not disrupt the natural reading flow of the page. It should be placed above, beside or below the main content, not within it.
- The ad placement should result in at least a 0.1% CTR (click-through rate). This will be reported in your publisher dashboard.
We currently have a **70% revenue share** with publishers
We handle payouts once a month,
with a minimum payment of **$50**.
- Stripe Connect (Bank transfer)
- Paypal
- OpenCollective
- GitHub Sponsors
- Multiple views of an ad within a short period from the same browser
```

### E6 — Privacy Policy: IP addresses and Do Not Track

```
We analyze potentially personally-identifying information like Internet Protocol (IP) addresses although we generally do not store this information. It is used in real-time for geo-targeting advertising and fraud prevention. Logs containing IP addresses are deleted after no more than 10 days.
- We **do not** do behavioral ad targeting regardless of your DNT preference. We target advertising exclusively based on geography and the content of the page.
- Regardless of DNT preference, our logs that contain IP addresses and user agent strings are deleted after 10 days unless a DNT exception applies.
```

### E7 — Privacy Policy: cookies and local storage

```
If you do not attempt to login to EthicalAds (as a publisher or advertiser for example), you generally do not receive any identifying cookie from us.
EthicalAds does not use any cookie-like functionality (eg. identifiers in local storage). Where a cookie is required, we use cookies directly.
```

### E8 — Publisher FAQ: how ads are targeted

```
We target ads on two primary things: visitor location and page content.
Location targeting uses the IP address of the visitor,
but we only target this to the country level.
IP addresses are not stored.

For page content, we crawl sites just like a search engine spider does
This is how EthicalAds serves relevant ads without using any personal data or tracking.
```

### E9 — Ad client source (`index.js`): request hosts and what is sent

```
 * This is native JavaScript, no JQuery. It uses the API JSONP interface to get
 * around CORS and related issues. A script is added with a callback on
 * There is some potential for problems if CSP rules disallow inline
 * stylesheets, but webpack does allow for a hardcoded nonce.
const AD_DECISION_URL = "https://server.ethicalads.io/api/v1/decision/";
const ABP_DETECTION_PX = "https://media.ethicalads.io/abp/px.gif";
      // location.href includes query params (possibly sensitive) and fragments (unnecessary)
      url: (window.location.origin + window.location.pathname).slice(0, 256),
```

### E10 — Ad client docs: keywords for pages the crawler cannot reach, SPAs

```
    EthicalAds uses a crawler (similar to a search engine)
    to crawl our publishers' sites and figure out the appropriate keywords and topics for each
    page where ads appear. Most publishers won't need to do anything for EthicalAds
    to appropriately target the right advertisers to the right pages on publisher sites.
    This API is mostly for SPAs or other non-traditional sites
    where our crawler won't work.
Single-page applications (SPAs) rewrite rather than reload the current page
```

### E11 — Ad client docs: installation

```
    <script async src="https://media.ethicalads.io/media/client/ethicalads.min.js"></script>
    <div data-ea-publisher="..." data-ea-type="text"></div>
```

### E12 — Terms of Service: acceptable use

```
Your use of our Network and Services must not violate any applicable
laws, including copyright or trademark laws, export control or sanctions
laws, or other laws in your jurisdiction.
```

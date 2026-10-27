Source: Carbon Ads' own pages (Carbon is run by BuySellAds), read from the Internet Archive's Wayback Machine copies:
- Publisher FAQ, https://www.carbonads.net/faq (snapshot 2026-10-15; page says "Last reviewed: September 2, 2026")
- Join the Publisher Network, https://www.carbonads.net/join (snapshot 2026-10-15)
- Placement Policy, https://www.carbonads.net/placement-policy (snapshot 2026-10-15)
- Privacy Policy, https://www.carbonads.net/privacy (snapshot 2026-10-15)
- BuySellAds Terms of Service, https://www.buysellads.com/terms (snapshot 2026-10-13; the FAQ points here for payout terms)
Captured: 2026-10-27
Method: carbonads.net and buysellads.com did not resolve from the capture machine (DNS returned no address for the ad network's domains, as an ad-blocking resolver does), so each page was fetched from `https://web.archive.org/web/2026id_/<url>` (the raw archived page) with a plain HTTPS GET, HTML stripped to text, and the lines below copied unedited. Where the page's markup splits one sentence into several text runs (links, bold numbers), the runs are joined with single spaces and nothing else is changed; lines between the quoted ones are left out, and a quoted line may stop or start mid-sentence. No account, application or sign-up. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment, build step 1 (pick a privacy-first ad network and check that it accepts the site).
FINDINGS (as the pages state them):
  - Acceptance: invitation only, after review of an application with URL and traffic statistics, answered in 5 to 7 business days (E1). Criteria are relevance to the audience, monthly page views, active maintenance, network capacity and compliance with placement and exclusivity rules (E1); no numeric traffic minimum is published. Target audience is "English-speaking developers and designers", mainly US, Canada and Europe (E2). The join page speaks of "tech and design voices" (E4). Gaming is not mentioned.
  - Cookies and tracking: CONFLICTING. The join page says "We use pixels, not cookies" and "No cookies" (E4). The privacy policy says some services "may employ cookies" in ad serving to help choose ads, with a cookie "unique to the specific computer" recording pages viewed and when, set on `carbonads.net`, `syndicateads.net` or similar (E5). Neither page says that no consent banner is needed. For ADR-0021 decision 5 this must be treated as "may set a cookie" until Carbon confirms otherwise in writing.
  - Placement rules: only Carbon ads on pages where Carbon appears (exclusive network, no backfill), above the fold on desktop at 1366 x 768, within 3 viewport heights on mobile or mobile off, ad code from the dashboard unmodified and not self-hosted, loaded once per page, no auto-refresh except on client-side routing (E3, E6). Target CTR 0.07%; 14 days with no impressions pauses the placement (E6).
  - Payout: CPM quoted as a typical range of $1.20 to $2.30, not guaranteed (E2); the network sells "Native CPC Ads" to advertisers (site menu). Monthly earnings deposited into a BuySellAds account within 30 days, withdrawable within 60; minimum $1 before method minimums: PayPal $20 (fees apply), check $50, wire $500 ($35 fee); Open Collective quarterly (E2). Revenue share: not published.
  - Content rules: BuySellAds' acceptable-use list forbids, among other things, submitting "Materials that contain restricted or password only access pages, or hidden pages or images" (E7). Whether "Materials" covers a publisher's site (and so an app behind a login) or only ad creatives is not defined on the page: [NEEDS VERIFICATION]. Publishers warrant their materials do not infringe (terms, warranty clause, not excerpted).
NOT FOUND (recorded, not guessed):
  - Any rule on serving the ad inside an iframe, or on a page other than the approved site: [NEEDS VERIFICATION]. E6's "Don't modify or self-host the script" and "Load the ad code once per page" are the nearest rules.
  - Script, image and request hosts for CSP: not on any captured page [NEEDS VERIFICATION]. (A third-party forum post names `srv.carbonads.net`; not a Carbon source, not relied on.)
  - The revenue share percentage, and whether a site with no traffic history can be invited.
  - Whether Carbon's ad tag itself sets cookies or uses local storage on the publisher's page (E4 and E5 disagree).

### E1 — FAQ: invitation, what Carbon looks for, how to apply

```
Can I display your ads on my site?
Yes, by invitation only.
We carefully select both publishers and advertisers to maintain network quality.
We evaluate:
Relevance of our ads to your audience.
Your average number of monthly page views.
Whether your site is actively maintained.
Current capacity in our network for new publishers.
Your ability to comply with our terms of service , including ad placement and exclusivity requirements.
Submit your website URL and traffic statistics through our application form. We review applications within 5–7 business days.
```

### E2 — FAQ: audience, earnings, payout

```
English-speaking developers and designers , primarily in the United States, Canada, and Europe.
Typical range: $1.20 – $2.30 CPM (cost per thousand impressions).
Engagement (CTR) and current advertiser demand matter too, and no rate is guaranteed.
each month’s earnings are deposited into your BuySellAds account within 30 days of that month closing
and become available to withdraw within 60 days of the close.
What is the minimum payout?
$1 (before withdrawal-method minimums are applied).
Paypal : $20 minimum balance, transaction fees apply.
Check : $50 minimum balance.
Wire Transfer : $500 minimum balance, $35 fee.
As of March 2026, Open Collective payouts are processed once per quarter.
```

### E3 — FAQ: exclusivity

```
Carbon is an exclusive network. When you join, you agree to display only Carbon ads on your site and not use Carbon as backfill for other ad networks.
```

### E4 — Join page: privacy claim and audience

```
Carbon empowers tech and design voices.
Respecting Privacy, Driving Revenue
Ethically maximizing open-source revenue. We use pixels, not cookies, to attract premium advertisers.
Implement pixel-based tracking for premium ad campaigns, boosting your project’s revenue without compromising user privacy. No cookies, just clean, efficient monetization.
Our team manually reviews your projects and assigns relevant categories, ensuring displayed ads actually matter to your users.
```

### E5 — Privacy Policy: ad-serving cookies

```
Some of the Services may employ cookies to collect non-Personally Identifiable Information in the course of providing clients with ad-serving services, for the purpose of helping clients determine which advertisement is suitable to be delivered to a user, or to maintain a user’s state (keeping them logged in, etc.).
The cookie is associated with and unique to the specific computer.
We collect into the cookie only non-Personally Identifiable Information such as the type of the computer’s operating system, type of internet browser software, what web pages were viewed and at what time, and geographic location of user’s internet service provider.
The domain that we set cookies during your use of our Services is typically carbonads.net, syndicateads.net, or the self-service direct instance of the domain name of the Service you are using
```

### E6 — Placement Policy

```
Use only the ad code from your dashboard. Don’t modify or self-host the script.
Load the ad code once per page.
In React, Vue, or similar frameworks, load the script as a client component.
Don’t auto-refresh ads unless your site uses client-side routing (SPA).
Don’t use Carbon as backfill for other ad networks.
The ad must be visible on initial page load at 1366 × 768 viewport or larger.
No other ad networks on pages where Carbon appears.
The ad must appear within 3× the viewport height from the top.
Alternatively, you can disable ads on mobile entirely.
Target CTR is 0.07% (network average).
14 days with no impressions triggers a temporary pause.
```

### E7 — BuySellAds Terms of Service: acceptable use

```
(f) submitting Materials that contain restricted or password only access pages, or hidden pages or images;
```

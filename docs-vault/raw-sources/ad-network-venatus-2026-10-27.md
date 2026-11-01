Source: Venatus' own pages (a gaming-focused ad platform):
- Home, https://www.venatus.com/
- Consent Management for Publishers, https://www.venatus.com/platform/benefits/consent-management
- Privacy Notice, https://www.venatus.com/privacy-policy
- Website Monetization, https://www.venatus.com/publishers/website-monetization
Captured: 2026-10-27
Method: plain HTTPS GET of each page, HTML stripped to text, the lines below grepped and copied unedited (lines between the quoted ones left out). The knowledge-base article on consent that a web search listed (support.venatus.com, "consent-management-platform-and-gdpr") returned HTTP 404 live and on the Wayback Machine, so it is not captured. No account, application or sign-up. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment, build step 1. A CONTRAST, not a candidate: the gaming-audience programmatic option, captured to show why "gaming-friendly" and "privacy-first" pull apart.
FINDINGS (as the pages state them):
  - Model: header bidding and programmatic demand alongside direct sales (E1). Gaming is its core audience (site menu: "Core Gaming", "Casual Gaming", "Kids Gaming").
  - Cookies and consent: Venatus ships a built-in consent management platform to its publishers (E2) and participates in the IAB Europe Transparency & Consent Framework as vendor 26 (E3); its privacy notice says it collects device identifiers, page-view statistics, referral URL, ad data and IP address "using cookies or similar technologies", after asking permission (E3; the notice covers "any of our websites or services", and does not separate ad serving on publisher sites from Venatus' own site). That is consent-banner advertising: it fails ADR-0021 decisions 3 and 5 outright.
NOT FOUND (recorded, not guessed):
  - Publisher acceptance criteria and any traffic minimum: none on Venatus' pages [NEEDS VERIFICATION]. (A third-party blog states a figure; not a Venatus source, not relied on.)
  - Payout model, revenue share, minimum payout, payment methods.
  - Any rule on iframes, login-protected pages or fan content.
  - CSP hosts for its tag.

### E1 — Home: programmatic plus direct

```
Prosper's predictive technology surfaces the right demand at the right moment — combining premium direct sales with optimized programmatic to maximize your yield.
```

### E2 — Consent Management for Publishers

```
As part of our platform, we offer our publishers a built-in CMP (consent management platform). This means that publishers can rest assured that they are following data regulations and can continue to concentrate on creating great content.
```

### E3 — Privacy Notice: TCF vendor, device information

```
Venatus Media Limited participates in the IAB Europe Transparency & Consent Framework and complies with its Specifications and Policies. Venatus Media Limited’s vendor identification number within the framework is 26.
We also collect information from your devices (including mobile devices) and browsers you use to access and use any of our websites or services (for example, we may collect the device identification number and type, location information and connection information such as statistics on your page views, traffic to and from the sites, referral URL, ad data, and your IP address) and we will ask for your permission before we do so. We may do this using cookies or similar technologies
```

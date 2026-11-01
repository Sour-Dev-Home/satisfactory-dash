Source: Google AdSense Help and Google Publisher Policies pages (English):
- Personalized and non-personalized ads, https://support.google.com/adsense/answer/9007336?hl=en
- Limited ads, https://support.google.com/adsense/answer/14210870?hl=en
- Ad placement policies, https://support.google.com/adsense/answer/1346295?hl=en
- Special ad implementations permitted by our policies, https://support.google.com/adsense/answer/1354742?hl=en
- Eligibility requirements for AdSense, https://support.google.com/adsense/answer/9724?hl=en
- AdSense revenue share, https://support.google.com/adsense/answer/180195?hl=en
- Payment thresholds, https://support.google.com/adsense/answer/1709871?hl=en
- Google Publisher Policies, https://support.google.com/publisherpolicies/answer/10502938?hl=en
Captured: 2026-10-27
Method: plain HTTPS GET of each page, HTML stripped to text, the lines below grepped and copied unedited (lines between the quoted ones left out; a quoted line may stop mid-sentence; where markup splits a sentence into text runs, the runs are joined with single spaces). No account or sign-up. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment, build step 1. A CONTRAST, not a candidate: AdSense is the default low-barrier network, captured to show what the privacy-first constraint rules out.
FINDINGS (as the pages state them):
  - Acceptance: no traffic minimum on the eligibility page; the applicant must be 18 or over, own the site and have "unique and interesting content" that complies with the program policies (E5). No topic restriction against games.
  - Cookies: even non-personalised ads "still use cookies or mobile ad identifiers for frequency capping and aggregated ad reporting", and consent is required for that "in the UK, Switzerland, and certain countries in the European Economic Area (EEA) per the ePrivacy Directive" (E1). Limited ads, the mode for traffic without consent, still use "invalid traffic detection-only cookies & local storage" (Google says it does not require consent for that) and the publisher must still meet the EU user consent policy (E2). So AdSense means a consent banner (a certified CMP) for EEA/UK visitors, or a legal judgement on limited ads: it fails ADR-0021 decision 5.
  - Login and iframes: Google "may disable ad serving on content that cannot be evaluated", including "password-protected content where the publisher has not provided login credentials to Google" (E3). The only iframe rule found is the ban on "Using IFRAMEs with keywords to alter the content or language of the ads" (E4); a blanket rule on serving AdSense from an iframe on another origin was not found on these pages: [NEEDS VERIFICATION].
  - Clicks: "Publishers are not permitted to open Google ads in a new window or alter the result of clicking on an ad" (E3); ADR-0021's sandbox (no top navigation, clicks open a new tab) would have to leave click behaviour to Google's own code.
  - Payout: 80% of revenue for AdSense for Content after the buy-side fee, about 68% when the advertiser buys through Google Ads (E6). Payment threshold amount is in a linked table, not in the captured text: [NEEDS VERIFICATION].
  - Content: Google Publisher Policies forbid content that "infringes copyright", handled by DMCA notices (E7); the site's game icons and terrain are a game publisher's assets used as fan content, so a notice would reach this policy.
NOT FOUND (recorded, not guessed):
  - CSP hosts for the AdSense tag (script, frame, image, connect): not on these pages [NEEDS VERIFICATION]; Google's tag loads many Google ad domains, which is itself a reason it does not fit an isolated, minimal-CSP ad origin.
  - The payment threshold figure and payment methods (linked from the "Payment thresholds" page, not captured).

### E1 — Personalized and non-personalized ads: cookies and consent

```
Although non-personalized ads don’t use cookies or mobile ad identifiers for ad targeting, they do still use cookies or mobile ad identifiers for frequency capping and aggregated ad reporting.
You must obtain consent to use cookies or mobile ad identifiers for those purposes where legally required, such as in the UK, Switzerland, and certain countries in the European Economic Area (EEA) per the ePrivacy Directive.
```

### E2 — Limited ads: cookies and local storage without consent

```
Only when Programmatic limited ads are turned on, invalid traffic detection -only cookies & local storage will be used to help defend against fraud and abuse. When programmatic limited ads are enabled we will use Shared Storage API for IVT-only purposes. Google does not require publishers to obtain consent for this use case.
Where no CMP is present, publishers are reminded that they must still comply with all relevant provisions of the EU user consent policy
Publishers that do not want to use invalid traffic-only cookies and local storage without user consent should opt out of this feature by turning it off in the AdSense user interface.
```

### E3 — Ad placement policies: new windows, content that cannot be evaluated

```
Publishers are not permitted to open Google ads in a new window or alter the result of clicking on an ad.
In order to protect the quality of our ad network, we may disable ad serving on content that cannot be evaluated. This includes but is not limited to content whose robots.txt file blocks Google’s crawling and password-protected content where the publisher has not provided login credentials to Google.
```

### E4 — Special ad implementations: the iframe example

```
Using IFRAMEs with keywords to alter the content or language of the ads.
```

### E5 — Eligibility requirements

```
you're 18 or over
Do you have your own unique and interesting content?
Your content must be high-quality, original, and attract an audience.
```

### E6 — AdSense revenue share

```
For displaying ads with AdSense for Content, publishers receive 80% of the revenue, after the advertiser platform takes its fee, whether that be Google’s buy-side or third-party platforms. For example, when advertisers use Google Ads to purchase display ads on AdSense, publishers keep about 68% percent of the revenue. AdSense pays publishers an effective cost per mille (eCPM) for advertiser bids.
```

### E7 — Google Publisher Policies: intellectual property

```
Intellectual property abuse
We do not allow content that:
infringes copyright. It is our policy to respond to notices of alleged infringement that comply with the Digital Millennium Copyright Act (DMCA).
```

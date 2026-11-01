Source: Google AdSense Help, Google Publisher Policies Help and Google for Developers pages (English):
- Integrate the AdSense ad code with a Content Security Policy (CSP), https://support.google.com/adsense/answer/16283098?hl=en
- Integrate with a Content Security Policy (Google Publisher Tag), https://developers.google.com/publisher-tag/guides/content-security-policy?hl=en (page says "Last updated 2025-07-31 UTC")
- About Privacy & messaging, https://support.google.com/adsense/answer/10924669?hl=en
- How the Google Consent Management Platform (CMP) works, https://support.google.com/adsense/answer/16918505?hl=en
- Google consent management requirements for serving ads in the EEA, the UK, and Switzerland (for publishers), https://support.google.com/adsense/answer/13554116?hl=en
- Connect your site to AdSense, https://support.google.com/adsense/answer/7584263?hl=en
- Create a European regulations message, https://support.google.com/adsense/answer/10960768?hl=en
- About European regulations messages, https://support.google.com/adsense/answer/10961068?hl=en
- Add a consent revocation link to your site, https://support.google.com/adsense/answer/10959060?hl=en
- Privacy & Messaging JavaScript API, https://developers.google.com/funding-choices/fc-api-docs?hl=en
- Publisher integration with the IAB Europe TCF, https://support.google.com/adsense/answer/9804260?hl=en
- Ads personalization settings in Google's publisher ad tags, https://support.google.com/adsense/answer/7670312?hl=en
- Commonly asked questions about European regulations messages, https://support.google.com/adsense/answer/11546682?hl=en
- About US state regulations messages, https://support.google.com/adsense/answer/10961479?hl=en
- Limited ads, https://support.google.com/adsense/answer/14210870?hl=en
- Display ads on login-protected pages, https://support.google.com/adsense/answer/161351?hl=en
- Ad placement policies, https://support.google.com/adsense/answer/1346295?hl=en
- Google-served ads on screens without publisher-content, https://support.google.com/publisherpolicies/answer/11112688?hl=en
- More ads or paid promotional material than publisher-content, https://support.google.com/publisherpolicies/answer/11169917?hl=en
Captured: 2026-11-01
Method: plain HTTPS GET of each page, HTML stripped to text, the lines below grepped and copied unedited (lines between the quoted ones left out; a quoted line may stop mid-sentence; where markup splits a sentence into text runs, the runs are joined with single spaces). No account sign-in. These pages carry no licence permitting redistribution (the developers.google.com pages are CC BY 4.0, but the same rule is kept for all), so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment 2, build step 1 ("Capture the AdSense CSP domains and the CMP setup docs to `raw-sources/`"). Feeds build step 2 (CMP and consent gate), step 3 (crawler account), step 4 (slots and CSP).
FINDINGS (as the pages state them):
  - CSP: AdSense does NOT support a domain allowlist. "Because the domains that the AdSense ad code uses change over time, we only support strict CSP" (E1). The supported policy is `object-src 'none'; script-src 'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:; base-uri 'none';` plus a report-uri, and "More restrictive policies may break without notice" (E1). The nonce goes on every script tag, the AdSense one included (E1). Google Publisher Tag says the same, word for word (E2), and adds that same-domain ad iframes inherit the page's CSP (E2).
  - CSP, other directives: neither page lists frame-src, img-src or connect-src origins, nor allows any. The documented policy sets no `default-src`, so those fetches are unrestricted in Google's example. A list of Google ad hosts for those directives is not documented: [NEEDS VERIFICATION], and by E1 Google would not support one.
  - CSP, nonce vs hash: Google documents a nonce only. Whether a hash-based strict CSP (no per-response nonce) works with the AdSense code is not documented: [NEEDS VERIFICATION].
  - CMP is certified: the Privacy & messaging European regulations message is "certified in accordance with the new TCF requirement" (E4); a certified CMP is required only for personalised ads in the EEA, UK and Switzerland, and traffic from a non-certified CMP may still get non-personalised or limited ads (E3).
  - CMP is deployed by the AdSense tag itself: "your existing Google Publisher Tag or AdSense tag deploys user messages once the message is published" (E7); the create-message page says "Make sure you've placed the AdSense code on your site" (E6), and message testing needs "the AdSense code ... located on the page" (E5). No separate CMP script tag or its origin is documented for AdSense sites: the origin the CMP script loads from is [NEEDS VERIFICATION] (with `'strict-dynamic'` it needs no CSP entry of its own).
  - Enabling it: when requesting the site review, "select a consent management platform (CMP) option"; choosing Google's CMP auto-creates a European regulations message for the site (E5). Or create one in Privacy & messaging: select sites, languages, the "Do not consent" option (per country), name, privacy policy URL, Publish (E6). Messages need a referrer policy that shares the Referer cross-origin, e.g. `strict-origin-when-cross-origin` (E6).
  - Gating ad requests: Google's ad tags read the TC string from the CMP automatically (E8). Google says "If you do not have consent for Google for Purpose 1 ... you should not call Google's ad tag", yet its own table says that without Purpose 1 consent "Limited ads can serve" (E8). The AdSense tag can be paused before any `adsbygoogle.push(...)` with `pauseAdRequests=1` and resumed with `=0`; while paused "various scripts are still loaded", existing Google cookies may be read but no new ones set (E9). The alternative is to defer loading `adsbygoogle.js` (E9), but then Google's CMP, which the same tag deploys (E7), cannot show.
  - Withdrawing consent: AdSense adds the revocation link automatically on approved sites that carry the AdSense code; a site may add its own with `googlefc.callbackQueue.push(googlefc.showRevocationMessage)`, e.g. a "Privacy and cookie settings" link (E10). The call "Clears the consent record and reloads the googlefc script" (E7). On revocation the message always shows three buttons (E11).
  - US states: a "US state regulations" message type exists (20 states listed, E12), showing a "Do Not Sell or Share My Personal Information" link and an opt-out dialog, and writing IAB GPP (E12). It is an opt-out, not a consent gate.
  - Limited ads: no personal data for personalisation; tags still cached, IP addresses still used; when programmatic limited ads are on, invalid-traffic-only cookies, local storage and the Shared Storage API are used, and "Google does not require publishers to obtain consent for this use case" (E13). Limited ads are served when TCF choices allow neither personalised nor non-personalised ads, and also for EEA/UK/Swiss requests with no TC string from a certified CMP (E13). "Limited ads are turned on by default" and can be turned off under Brand Safety > Blocking controls > Ad serving (E13). Whether using them without consent is lawful is left to the publisher (E13). Non-personalised ads still need cookie consent where the ePrivacy Directive applies (E9, E14). Note the FAQ's no-cookie statement for limited ads names Ad Manager and AdMob, not AdSense (E14).
  - Login-protected pages: a crawler login can be added only "After your account has been activated", under Account > Access and authorization > Crawler access, with a restricted URL, login URL, method (POST or GET) and key-value login parameters "such that your server will return a cookie for logged-in access"; the site must also be verified in Search Console with the same Google Account (E15).
  - Placement limits: no numeric ads-per-page limit on these pages; ads must not exceed publisher-content, which excludes whitespace, header, footer and links (E17); no ads on screens without publisher-content, under construction, or "used for alerts, navigation or other behavioral purposes", nor on dead-end screens such as Thank You, Exit or Error (E16); take care placing navigation buttons or "game windows" near ads (E18); ad labels only "Advertisements" or "Sponsored Links" (E18); no ads in software applications, including desktop applications (E18); no ads in windows without navigation controls, or on sites with more than three pop-ups (E18).
NOT FOUND (recorded, not guessed):
  - A frame-src / img-src / connect-src host list for AdSense (Google supports only strict CSP, E1).
  - The origin of the Privacy & messaging script on an AdSense site.
  - Whether a hash-based strict CSP is supported.
  - How Google's CMP interacts with `pauseAdRequests` (whether the CMP itself holds ad requests until a choice is made is not stated on these pages).
  - Google's role (processor or controller) for the privacy page: not on these pages.

### E1 — AdSense: strict CSP only, the supported policy

```
Note that publishers are not required to use CSP. If you do want to use CSP, follow the steps below to ensure your AdSense code works correctly when you enable CSP.
Important: You must update your site’s CSP to comply with our documented guidance. Failure to do so may result in a disruption of ad serving on your site.
Specify an allowlist of domains that can inject their resources on the page.
Specify a random nonce, with which resources on the page must be marked in order to load. This approach is known as strict CSP.
Because the domains that the AdSense ad code uses change over time, we only support strict CSP (option 2). This approach removes the need to maintain a rolling list of domains that might become outdated and break your site.
To enable CSP on your web server, follow the steps outlined in Adopt a strict CSP which explains how to set up the CSP header and apply the nonce to every script tag on your page, including the AdSense code. The AdSense code specifically supports the following CSP directives:
Content-Security-Policy:
object-src 'none';
script-src 'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:;
base-uri 'none';
report-uri https://your-report-collector.example.com/
You can choose a more permissive policy if it fits your use case. More restrictive policies may break without notice.
<script nonce="${nonce}" async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234&host=ca-host-pub-5678" crossorigin="anonymous">
We recommend that you test your policies first by setting the Content-Security-Policy-Report-Only header instead of Content-Security-Policy. The header reports violations but still allows them on the page.
```

### E2 — Google Publisher Tag: the same policy; ad iframes and CSP

```
Because the domains that Google Publisher Tag (GPT) uses change over time, we only support strict CSP (option 2). This approach removes the need to maintain a rolling list of domains that might become outdated and break your site.
script-src 'nonce-{random}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:;
Ad iframes can load external resources that might not be permitted by the CSP. Since same domain iframes inherit the top level window's CSP, and GPT cannot control the creative’s contents, same-domain creatives will generally not work properly with CSP headers.
```

### E3 — Certified CMP requirement

```
To comply with the EU User Consent Policy, partners using our publisher products—Google AdSense, Ad Manager, or AdMob—are required to use a consent management platform (CMP) that has been certified by Google and integrates with the IAB's Transparency and Consent Framework (TCF) when serving personalized ads to users in the following regions:
EEA and UK: As of 16 January 2024, a certified CMP integrated with the TCF is required when serving personalized ads to users in the EEA and UK.
Switzerland: As of 31 July 2024, a certified CMP integrated with the TCF is required when serving personalized ads to users in Switzerland.
Certified CMP traffic: Only traffic from a certified CMP is eligible for personalized ads. Traffic from a certified CMP will continue to be eligible for personalized ads, non-personalized ads, and limited ads (including programmatic limited ads) where supported.
Traffic from a non-certified CMP: Traffic from a non-certified CMP may be eligible for non-personalized ads or limited ads (including programmatic limited ads) where supported.
```

### E4 — Google's own CMP is certified

```
Google LLC CMP
300
Web and app
Publishers using Google’s Privacy & messaging European regulations messages: We encourage publishers to consider which CMP solution is best for them. To support publishers, the European regulations message available to Ad Manager, AdSense, and AdMob publishers in the "Privacy & messaging" tab are certified in accordance with the new TCF requirement.
```

### E5 — Choosing the CMP at site review; testing needs the AdSense code

```
(Optional) Once you have requested the site review, select a consent management platform (CMP) option and click Submit.
If you choose to use Google's CMP, we will automatically create a European regulations message for this site and any sites you add going forward. You can choose from a two-button configuration ("Consent," "Manage options") or a three-button configuration ("Consent," "Manage options," "Do not consent").
Alternatively, you may choose to use a certified third-party CMP. A European regulations message won't be automatically generated for your site if you select this option.
In order for the query parameter to display the message, the message you're testing needs to be published to your site and the AdSense code needs to be located on the page.
```

The first three lines are from "Connect your site to AdSense"; the last is from "About Privacy & messaging", whose testing table also lists `?fc=alwaysshow&fctype=gdpr` ("Displays the European regulations message that is currently published for your site. Ignores region.").

### E6 — Create a European regulations message

```
Note: Make sure you've placed the AdSense code on your site.
Messages may not be eligible to show on web if the referrer-policy isn't configured to share the "Referrer" header on cross-origin requests. Ensure that your referrer policy allows cross-origin sharing (for example, strict-origin or strict-origin-when-cross-origin).
Navigate to Privacy & messaging.
In "User choices," make a decision for the "Do not consent" option.
ON: This message will present users with a choice to not consent to your ad partners and your ad partners' purposes with a single click on the first page of the message. You can specify the countries in which the "Do not consent" button is displayed.
Enter your site's privacy policy URL.
When you're ready, click Publish. Alternatively, click Save draft to save a draft of the message.
```

### E7 — Privacy & Messaging JavaScript API: deployed by the AdSense tag; revocation call

```
User messaging functionality can be deployed using existing Google Publisher or AdSense tags, except for ad blocking recovery messages which require an explicit ad blocking tag.
For most cases, you don't need to re-tag at all - your existing Google Publisher Tag or AdSense tag deploys user messages once the message is published in the relevant product.
Note: The only supported way to invoke any function is by adding it to the callbackQueue.
googlefc.showRevocationMessage()
Clears the consent record and reloads the googlefc script to show the consent message applicable to the user.
```

### E8 — Publisher integration with the IAB Europe TCF: tags read the TC string; Purpose 1

```
To integrate with the IAB Europe TCF, a publisher must implement an IAB registered TCF CMP on their site. The CMP creates and sends the TC (Transparency & Consent) string. Then, Google’s ad tags consume the TC string they receive from the CMP.
If you do not have consent for Google for Purpose 1 (Store and/or access information on a device), you should not call Google’s ad tag.
Passing TC string to tags: GPT, GPT Passbacks, AdSense, and Ad Exchange Tags will automatically communicate with the IAB CMP to forward the TC string to AdSense without publisher configuration.
Lack of consent for Google to store and/or access information on a device (Purpose 1)
Limited ads can serve.
We do not serve an ad if the TC string is invalid.
```

### E9 — Ads personalization settings: non-personalised ads still need cookie consent; pausing ad requests

```
Although these ads don’t use cookies for ad personalization, they do use cookies to allow for frequency capping and aggregated ad reporting. Consent is therefore required to use cookies for those purposes from users in countries to which the ePrivacy Directive’s cookie provisions apply.
Set the value: (adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=1
Use (adsbygoogle=window.adsbygoogle||[]).pauseAdRequests=1 to prevent the tag from sending ad requests. You must do this before triggering any ad requests by using adsbygoogle.push(...).
Use (adsbygoogle=window.adsbygoogle||[]).pauseAdRequests=0 to resume sending ad requests.
If you don't set pauseAdRequests=0, no ads will appear.
This technique blocks ad requests from being sent, but various scripts are still loaded. While existing cookies on Google’s domains may be read, no new cookies will be set. Any data associated with existing cookies will not be used for ad serving or measurement.
If your consent management solution offers a way to defer loading scripts until the user has exercised a choice, then another option is to defer loading gpt.js and adsbygoogle.js.
```

### E10 — Add a consent revocation link to your site

```
AdSense will automatically add the required European regulations message revocation link to sites on which you display European regulations messages. These links will only be added to sites that have been approved and also contain the AdSense code, and will be accompanied by text that states that you comply with the IAB TCF v2.0 policies.
Use the following function to call the revocation flow: googlefc.callbackQueue.push(googlefc.showRevocationMessage)
<a href=”javascript:googlefc.callbackQueue.push(googlefc.showRevocationMessage)”>Privacy and cookie settings</a>.
```

### E11 — About European regulations messages: revocation shows three buttons

```
It is your responsibility to make sure your messages meet legal requirements.
In accordance with IAB TCF guidelines, users must to be able to adjust their consent preferences after their initial choice. Therefore, when the European regulations message reappears – either through a revocation link or your site's privacy settings – it will always present three options: 'Do not consent,' 'Consent,' and 'Manage options.'
```

### E12 — About US state regulations messages

```
The US state regulations message type is displayed to users who are subject to privacy legislation specific to the state in which they’re located. For example, residents in California are subject to the California Privacy Rights Act (CPRA).
Do Not Sell or Share link: The link to your US state regulations message. Displays your "Do Not Sell or Share My Personal Information" link using the formatting and settings you selected. When users click the link, the Confirm page opens and displays the "Opt out of the sale or sharing of personal information" dialog.
Opt out: Allows users to opt out of the "sale or sharing" of their "personal information" (as the law defines those terms). When users click Opt out, the message communicates their opt-out status to Google. Closes the message.
US state regulations messages support the IAB Global Privacy Protocol (GPP) specification.
```

The page lists the states: California, Colorado, Connecticut, Delaware, Florida, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, Virginia.

### E13 — Limited ads

```
Limited ads (LTD) allow you to serve ads without using personal data for personalization. Limited ads disable the collection, sharing, and use of personal data for personalization of ads. Note the following:
Ad-serving technologies (our JavaScript tags and/or our SDK code) will still be cached or installed as part of the normal operation of users' browsers and mobile operating systems, and ad creatives will still be sent to, and in some instances cached on, devices. Data such as IP addresses will still be used to facilitate the transmission of the ad to the device.
Only when Programmatic limited ads are turned on, invalid traffic detection-only cookies & local storage will be used to help defend against fraud and abuse. When programmatic limited ads are enabled we will use Shared Storage API for IVT-only purposes. Google does not require publishers to obtain consent for this use case.
If a publisher uses the IAB Europe Transparency and Consent Framework (TCF 2), we will attempt to serve an eligible Limited Ad when the user preferences don’t allow serving Personalized Ads or Non-personalized Ads, but transparency has been established for Special Purpose 1 (ensure security, prevent and detect fraud, and fix errors), Special Purpose 2 (deliver and present advertising and content), and Google as a vendor.
Alternatively, a publisher can manually send a signal (see Implementation) and Google will similarly attempt to serve an eligible limited ad regardless of user location. Google will also attempt to serve an eligible limited ad for requests from the EEA, the UK, or Switzerland that don't include a TC string from a Google-certified CMP.
Limited ads are an optional feature. Publishers are legally responsible for the tools they use to gather consent, including consent for how they use cookies & local storage in online advertising. Publishers should work with their legal teams to determine for themselves whether to use this feature, taking into account relevant regulations and applicable regulator guidance.
Limited ads are turned on by default and can be turned off at any time. Complete the following steps to turn off limited ads:
Navigate to Brand Safety, then Blocking controls, and then Ad serving.
Turn off Limited ads.
```

### E14 — European regulations FAQ: non-personalised ads need cookies; the limited-ads line names Ad Manager and AdMob

```
If you monetize only with Non Personalized Ads, have you checked that you obtain users’ consent to the use of cookies or other local storage (like mobile device identifiers), where legally required? Please note that the non-personalized ads that we serve on websites still require cookies to operate.
If you monetize Ad Manager and AdMob impressions only with limited ads, in addition to disabling the collection, sharing, and use of personal data for personalization of ads, Google does not access cookies, user identifiers, or equivalent local storage on the end user’s device.
```

### E15 — Display ads on login-protected pages

```
After your account has been activated, you can display Google ads on the pages of your site behind a login by creating a crawler login. This will give the AdSense ads crawler access to visit your site and deliver ads.
You'll need to provide login details for your site, and verify your site using Search Console.
Click Access and authorization, then click Crawler access.
Restricted directory or URL: The URL that is blocked from our crawler's access.
Login URL: The URL that our crawler should visit to sign in.
Login method: The method your site uses to authenticate users who log in. POST and GET are common authentication methods.
Login parameters: The credentials that our crawler will use to sign in (for example, your site's username and password). For GET and POST methods, enter the URL parameter key-value pairs such that your server will return a cookie for logged-in access. Click + Add another parameter if you want to add any additional parameters.
Sign in to Search Console using your Google Account. You must be using your Google Account in order for any changes you make in Search Console to be reflected in your AdSense account.
```

### E16 — Google-served ads on screens without publisher-content

```
We do not allow Google-served ads on screens:
without publisher-content or with low-value content,
that are under construction,
that are used for alerts, navigation or other behavioral purposes
Ads should not be placed on "dead end" or no content screens (e.g., Thank You, Exit, Error pages, etc.)
Don’t place ads on automatically generated content without manual review or curation.
```

### E17 — More ads or paid promotional material than publisher-content

```
Advertising and other paid promotional material added to your pages should not exceed publisher-content. Publisher-content includes images, videos, games, article text and user-generated content created or managed by the publisher, but it does not include whitespace, header or footer content, or links to other content on the site.
Multiple ad units can help optimize your performance by leveraging our large inventory of ads but remember less can be more. Provided you don't place more ads than content on your pages, you can put a combination of ad units, link units and/or search boxes on each page of your site.
```

### E18 — Ad placement policies: accidental clicks, labels, software, pop-ups

```
Be careful when placing links, play buttons, download buttons, navigation buttons (e.g., “Previous" or “Next"), game windows, video players, drop-down menus, or applications near ads because they might lead to accidental clicks. Even if the layout unintentionally leads to accidental clicks, publishers may still receive a violation notification.
Publishers may only label Google ads with either "Advertisements" or "Sponsored Links".
Publishers are not permitted to distribute Google ads or AdSense for search boxes through software applications including, but not limited to toolbars, browser extensions, and desktop applications. AdSense code may only be implemented on web-based pages and approved WebView technologies.
Publishers are not permitted to place Google ads in any window that is not initiated by an intentional user interaction (e.g., click). Additionally, Google ads may not be placed in any web browser window that lacks navigational controls, including back and forward browse buttons, and an editable URL field.
Publishers are not permitted to place Google ads on sites which have more than three pop-ups.
```

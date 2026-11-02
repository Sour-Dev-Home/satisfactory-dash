Source: Google AdSense Help, Google Publisher Policies Help, Google Privacy & Terms and Google Business Data Responsibility pages (English):
- Required content, https://support.google.com/adsense/answer/1348695?hl=en
- Privacy disclosures, https://support.google.com/publisherpolicies/answer/10437794?hl=en
- EU user consent policy, https://www.google.com/about/company/user-consent-policy/
- How Google uses information from sites or apps that use our services, https://policies.google.com/technologies/partner-sites?hl=en (the Privacy disclosures page links it as https://www.google.com/policies/privacy/partners/)
- Advertising (Google Privacy & Terms, Technologies), https://policies.google.com/technologies/ads?hl=en
- Google Ads Controller-Controller Data Protection Terms, https://business.safety.google/adscontrollerterms/
- Google Ads Data Protection Terms: Service Information, https://business.safety.google/adsservices/
Captured: 2026-11-01
Method: plain HTTPS GET of each page, HTML stripped to text, the lines below grepped and copied unedited (lines between the quoted ones left out; a quoted line may stop mid-sentence; where markup splits a sentence into text runs, the runs are joined with single spaces). Link targets named in FINDINGS were read from the same pages' HTML. No account sign-in. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
Why it is here: ADR-0021 amendment 3, build step 6 (privacy page wording). What Google says a publisher's privacy policy must disclose when it shows AdSense ads, and Google's role for the ad data. Complements [`adsense-csp-and-cmp-2026-11-01.md`](./adsense-csp-and-cmp-2026-11-01.md) (CMP, limited ads, revocation) and [`ad-network-adsense-2026-10-27.md`](./ad-network-adsense-2026-10-27.md) (cookies for non-personalised ads).
FINDINGS (as the pages state them):
  - AdSense's "Required content" page lists what "Your privacy policy should include": third-party vendors, including Google, use cookies to serve ads based on prior visits to this or other websites; Google's advertising cookies let it and its partners serve ads based on visits to this and other sites; users may opt out of personalised advertising at Ads Settings (linked as `https://www.google.com/settings/ads`), or of a third-party vendor's cookies at www.aboutads.info (linked as `http://www.aboutads.info/choices/`) (E1).
  - If the publisher has not opted out of third-party ad serving, the policy must also name the other vendors and ad networks serving ads, link to them, and say users may opt out there (E1). Google gives no model wording ("we're unable to suggest specific privacy policy language") (E1).
  - The Publisher Policies' "Privacy disclosures": the policy must clearly disclose data collection, sharing and use resulting from Google products, "including information about the technologies used, such as your use of cookies, web beacons, IP addresses, or other identifiers", and that "third parties may be placing and reading cookies ... or using web beacons or IP addresses to collect information as a result of ad serving" (E2). The publisher may meet the Google part with "a prominent link" to "How Google uses data when you use our partners' sites or apps" (E2).
  - EU user consent policy (EEA, UK, Switzerland): obtain legally valid consent for cookies or local storage where legally required, and for personalised ads; keep consent records; give "clear instructions for revocation of consent"; "clearly identify each party" that may collect, receive or use personal data, with "prominent and easily accessible information about that party's use" (E3).
  - Google's partner-sites page: a visit to a site using AdSense sends Google the page URL and the IP address, and Google may set or read cookies (E4); it uses the data to deliver and improve its services, measure ads, protect against fraud and abuse and, depending on settings, personalise ads (E4); with ad personalisation off it still shows ads, based on contextual factors (E4); to change or withdraw consent given to a site, "visit the site or app in question" (E4); controls include Ad Settings (linked as `https://adssettings.google.com`), blocking third-party cookies, and the partner site's own settings (E4).
  - Google's Advertising page: advertising cookies may be set from google.com, doubleclick.net, googlesyndication.com, googleadservices.com or the partner's domain, and partner services may set their own (E5); ad logs hold the IP address, browser data and cookies, anonymised by removing part of the IP after 9 months and cookie data after 18 months (E5); opt-out tools named: the aboutads.info choices page (linked as `https://www.aboutads.info/choices/`) and the EU-based Your Online Choices (linked as `https://www.youronlinechoices.com/uk/your-ad-choices`) (E5).
  - Google's role: AdSense and Funding Choices (ADR-0021 amendment 2 records it as Privacy & messaging's former name; the Privacy & Messaging JavaScript API lives under `developers.google.com/funding-choices`, see the CSP and CMP capture's source list) are listed as "Controller Services" under the Google Ads Controller-Controller Data Protection Terms, under which each party "is an independent controller of Controller Personal Data" (E6). Whether these terms are in force for this site's AdSense account (the terms apply to a customer who accepted them, E6) is not visible without signing in: [NEEDS VERIFICATION].
  - Transfers: the controller terms point to `business.safety.google/adsdatatransfers` for Google's transfer mechanisms (E6); that page was not captured: [NEEDS VERIFICATION].
NOT FOUND (recorded, not guessed):
  - Any wording Google requires in a privacy policy about limited ads, or about its CMP (Privacy & messaging). The CMP asks for the privacy policy's URL (`adsense-csp-and-cmp-2026-11-01.md` E6) and Google leaves the limited-ads legal judgement to the publisher (same file, E13), but neither page says what the policy must state about them.
  - A requirement to link `youronlinechoices.com`: the AdSense pages name only Ads Settings and aboutads.info (E1); Your Online Choices appears on Google's own Advertising page as a control tool (E5).
  - The list of other vendors and ad networks serving ads through AdSense on this site (E1 asks for it unless third-party ad serving is turned off): it depends on the account's settings [NEEDS VERIFICATION].
  - Google's legal bases for its own processing are in Google's Privacy Policy, which the partner-sites page refers to (E4); not captured.

### E1 — AdSense Help: Required content (privacy policy)

```
Google advertising cookies
Google uses cookies to help serve the ads it displays on the websites of its partners, such as websites displaying Google ads or participating in Google certified ad networks. When users visit a Google partner's website, a cookie may be dropped on that end user's browser.
My privacy policy
Your privacy policy should include the following information:
Third party vendors, including Google, use cookies to serve ads based on a user's prior visits to your website or other websites.
Google's use of advertising cookies enables it and its partners to serve ads to your users based on their visit to your sites and/or other sites on the Internet.
Users may opt out of personalized advertising by visiting Ads Settings . (Alternatively, you can direct users to opt out of a third-party vendor's use of cookies for personalized advertising by visiting www.aboutads.info .)
If you have not opted out of third-party ad serving , the cookies of other third-party vendors or ad networks may also be used to serve ads on your site, which should also be disclosed in your privacy policy in the following manner:
Notify your site visitors of the third-party vendors and ad networks serving ads on your site.
Provide links to the appropriate vendor and ad network websites.
Inform your users that they may visit those websites to opt out of the use of cookies for personalized advertising (if the vendor or ad network offers this capability). Alternatively, you can direct users to opt out of some third-party vendors’ uses of cookies for personalized advertising by visiting www.aboutads.info .
Because publisher sites and laws across countries vary, we're unable to suggest specific privacy policy language. However, you may wish to review resources such as the Network Advertising Initiative for guidance on drafting a privacy policy. For additional details regarding cookie consent notices, please refer to cookiechoices.org .
```

### E2 — Publisher Policies Help: Privacy disclosures

```
Privacy disclosures
Publishers must:
have and abide by a privacy policy that clearly discloses any data collection, sharing, and usage that takes place as a consequence of your use of Google products and services, including information about the technologies used, such as your use of cookies, web beacons, IP addresses, or other identifiers. This applies for data collection, sharing, and usage on any platform, surface, or property (e.g., web, app, Connected TV, gaming console, or email publication). The privacy policy must disclose to users that third parties may be placing and reading cookies on your users' browsers, or using web beacons or IP addresses to collect information as a result of ad serving on your website.
To comply with this disclosure obligation with respect to Google’s use of data, you have the option to display a prominent link to How Google uses data when you use our partners’ sites or apps .
```

### E3 — EU user consent policy

```
If your agreement with Google incorporates this policy, or you otherwise use a Google product that incorporates this policy, you must ensure that certain disclosures are given to, and consents obtained from, end users in the European Economic Area, the UK and Switzerland. If you fail to comply with this policy, we may limit or suspend your use of the Google product and/or terminate your agreement.
For Google products used on any site, app or other property that is under your control, or that of your affiliate or your client , the following duties apply for end users in the European Economic Area, the UK and Switzerland.
You must obtain end users’ legally valid consent to:
the use of cookies or other local storage where legally required; and
the collection, sharing, and use of personal data for personalization of ads.
When seeking consent you must:
retain records of consent given by end users; and
provide end users with clear instructions for revocation of consent.
You must clearly identify each party that may collect, receive, or use end users’ personal data as a consequence of your use of a Google product. You must also provide end users with prominent and easily accessible information about that party’s use of end users’ personal data.
```

### E4 — How Google uses information from sites or apps that use our services

```
Many websites and apps use Google services to market and improve their content and keep it free. When they use these services, they or their partners share information with Google.
For example, when you visit a website that uses advertising services like AdSense or Google Ads, including analytics tools like Google Analytics, or embeds video content from YouTube, your web browser automatically sends certain information to Google. This includes the URL of the page you’re visiting and your IP address. We may use the IP address, for example, to identify your general location, to measure the effectiveness of ads, and, depending on your settings, to improve the relevance of the ads you see. We may also set cookies on your browser or read cookies that are already there. Apps that use Google advertising services also share information with Google, such as the name of the app and a unique identifier for advertising.
Google uses the information shared by sites, apps and partners to deliver our services, maintain and improve them, develop new services, measure the effectiveness of advertising, protect against fraud and abuse, and depending on your settings, personalize content and ads you see on Google and on our partners’ sites and apps. For example, this information may be used to give you more personalized experiences across Google advertising services used by other advertisers. See our Privacy Policy to learn more about how we process data for each of these purposes and our Advertising page for more about Google ads, how your information is used in the context of advertising, and how long Google stores this information. See My Ad Center for more information on how personalized ads work and how to control what data is used to personalize ads from sites and apps that use our services.
Sometimes, when processing information shared with us by sites and apps, those sites and apps will ask for your consent before allowing Google to process your information. For example, a banner may appear on a site asking for consent for Google to process the information that site collects. When that happens, we will use your data for the purposes described in the consent you give to the site or app, rather than for all of the legal grounds described in the Google Privacy Policy. If you want to change or withdraw your consent, you should visit the site or app in question to do so.
If ad personalization is off, Google will not collect or use your information to create an ad profile or personalize the ads Google shows to you. You will still see ads, but they may not be as useful. Ads may still be based on contextual factors, such as the topic of the website or app you're looking at, your active searches, information about the videos you’ve just been watching, or your general location. Your information can still be used for the other purposes mentioned above, such as to measure the effectiveness of advertising and protect against fraud and abuse.
You can see and control what information we use to show you ads by visiting your ad settings .
Ad Settings helps you control ads you see on Google services (such as Google Search or YouTube), or on non-Google websites and apps that use Google ad services. You can also learn how ads are personalized, opt out of ad personalization, and block specific advertisers.
Many browsers, including Chrome, allow you to block third-party cookies. You can also clear any existing cookies from within your browser. But note that even if cookies are removed or disabled in your browser, Google may use cookie-based information or other advertising technologies to personalize ads unless you change your ads settings to turn off personalized ads. Learn more about managing cookies in Chrome .
Indicate on the partner website or app’s settings that you do not agree to the use or sharing of cookies or similar technologies for personalized advertising.
```

### E5 — Google Privacy & Terms: Advertising (cookies, logs, opt-out tools)

```
Many websites, such as news sites and blogs, partner with Google to show ads to their visitors. Working with our partners, we may use cookies for a number of purposes, such as to stop you from seeing the same ad over and over again, to detect and stop click fraud, and to show ads that are likely to be more relevant (such as ads based on websites you have visited).
We store a record of the ads we serve in our logs. These server logs typically include your web request, IP address, browser type, browser language, the date and time of your request, and one or more cookies that may uniquely identify your browser or, if you are signed-in, that may uniquely identify you. We store this data for a number of reasons, the most important of which are to improve our services and to maintain the security of our systems. We anonymize this log data by removing part of the IP address (after 9 months) and cookie information (after 18 months).
These may be set from a few different domains, including google.com, doubleclick.net, googlesyndication.com, or googleadservices.com, or the domain of our partners’ sites. Some of our advertising products enable our partners to use other services in conjunction with ours (like an ad measurement and reporting service), and these services may send their own cookies to your browser. These cookies will be set from their domains.
You can manage cookies in your web browser as well as through various online advertising consumer choice tools created under self-regulation programs including the US-based aboutads.info choices page or the EU-based Your Online Choices .
```

### E6 — Google Ads Controller-Controller Data Protection Terms; the services in scope

```
Google and the counterparty agreeing to these terms (“ Customer “) have entered into an agreement for the provision of the Controller Services (as amended from time to time, the “ Agreement ”)
“ Controller Services ” means the applicable services listed at business.safety.google/adsservices .
4.1 Independent Controllers . Subject to Section 4.3 (End Controllers), each party:
(a) is an independent controller of Controller Personal Data;
(b) will individually determine the purposes and means of its processing of Controller Personal Data; and
(d) Alternative Transfer Solution Adoption and Certification. Information about Google and/or its Affiliates’ adoption of, or certification under, any Alternative Transfer Solutions can be found at https://business.safety.google/adsdatatransfers .
```

The first six lines are from the Controller Terms page; the list below is from "Service Information":

```
The following Google services are eligible to be in scope of the Google Ads Controller-Controller Data Protection Terms:
AdSense
Funding Choices
```

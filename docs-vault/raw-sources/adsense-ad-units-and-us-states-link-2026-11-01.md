Source: Google AdSense Help and Google for Developers pages (English):
- Privacy & Messaging JavaScript API, https://developers.google.com/funding-choices/fc-api-docs?hl=en
- About US state regulations messages, https://support.google.com/adsense/answer/10961479?hl=en
- Create a US state regulations message, https://support.google.com/adsense/answer/10960771?hl=en
- Create a display ad unit, https://support.google.com/adsense/answer/9274025?hl=en
- How to modify your responsive ad code, https://support.google.com/adsense/answer/9183363?hl=en
- Use the data-ad-status parameter to hide unfilled ad units, https://support.google.com/adsense/answer/10762946?hl=en
Captured: 2026-11-01
Method: plain HTTPS GET of each page, HTML stripped to text, the lines below grepped and copied unedited (lines between the quoted ones left out; a quoted line may stop mid-sentence; where markup splits a sentence into text runs, the runs are joined with single spaces). No account sign-in. These pages carry no licence permitting redistribution (the developers.google.com page is CC BY 4.0, but the same rule is kept for all), so only the excerpts this repo cites are kept, verbatim. Excerpt numbers are prefixed U- to keep them apart from `adsense-csp-and-cmp-2026-11-01.md`'s E numbers.
Why it is here: ADR-0021 amendment 3, build step 4 (the AdSense script, the consent links in the footer, the ad slots). Complements `adsense-csp-and-cmp-2026-11-01.md` (E1-E18), which has the CSP, the CMP and the revocation link.
FINDINGS (as the pages state them):
  - US "Do Not Sell or Share" link, AdSense: the link is part of Google's US state regulations message. It "Displays your "Do Not Sell or Share My Personal Information" link using the formatting and settings you selected" and opens the opt-out dialog (U-E2). A site's own custom link (`googlefc.usstatesoptout.overrideDnsLink = true` plus `openConfirmationDialog`) "is only supported in Ad Manager" (U-E1). So on an AdSense site Google's tag renders the link itself and the site adds no link of its own. Where on the page Google renders it, and how it looks with the formatting the owner picked, is not stated: [NEEDS VERIFICATION] on the live site.
  - The US message, like the European one, needs the AdSense code on the page and a referrer policy that sends the Referer cross-origin (U-E3).
  - Ad units: a display ad unit is created in the account (Ads > By ad unit > Display ads); Google recommends Responsive; Fixed exists with a smaller ad pool (U-E4). The ad unit code is an `<ins class="adsbygoogle">` with `data-ad-client` and `data-ad-slot`, followed by `(adsbygoogle = window.adsbygoogle || []).push({})` (U-E5). The `data-ad-slot` value comes from the unit the publisher creates; it is not documented anywhere a site could derive it.
  - Exact sizes: responsive ad code may be modified to set an exact size per screen width with CSS media queries (320x100 below 500px, 468x60 from 500px, 728x90 from 800px in Google's example), and doing it these ways is an "acceptable modification" (U-E5). But "setting the size of the ad unit via CSS in external style sheets is not officially supported" (U-E5): Google's examples use a `<style>` element or a `style` attribute.
  - Unfilled units: after the request AdSense sets `data-ad-status` to `filled`, `unfilled` or `unfill-optimized`; an unfilled unit inside the viewport keeps its size and shows a blank space (only units outside the viewport are collapsed, so as not to reflow the page) (U-E6).
NOT FOUND (recorded, not guessed):
  - Where AdSense places the default "Do Not Sell or Share" link on the page.
  - Whether Auto ads are on for a newly approved site, and how Auto ads interact with manual units: not on these pages.

### U-E1 — Privacy & Messaging JavaScript API: the US states link override is Ad Manager only

```
googlefc.usstatesoptout.overrideDnsLink{undefined|boolean}
Set this field to true in order to hide the default Do Not Sell or Share link and use your own custom Do Not Sell or Share link. Note that this functionality is only supported in Ad Manager.
googlefc.ccpa.overrideDnsLink{undefined|boolean}
Set this field to true in order to hide the default Do Not Sell or Share link and use your own custom Do Not Sell or Share link. Note that if you set this field to true, you are responsible for rendering a Do Not Sell or Share link on your site. This field should be used in conjunction with openConfirmationDialog . Additionally, using your own custom Do Not Sell or Share link for "US States regulations" messaging functionality is only supported in Ad Manager.
googlefc.usstatesoptout.openConfirmationDialog(function(boolean)): {undefined}
Opens the US state regulations opt-out confirmation dialog if the default Do Not Sell link is overridden.
```

### U-E2 — About US state regulations messages: the link belongs to the message

```
Note : The look and feel of your "Do Not Sell or Share" link may look different from the styling shown above.
Do Not Sell or Share link : The link to your US state regulations message. Displays your "Do Not Sell or Share My Personal Information" link using the formatting and settings you selected. When users click the link, the Confirm page opens and displays the "Opt out of the sale or sharing of personal information" dialog.
When the "Do Not Sell or Share My Personal Information" link is shown on the page:
```

### U-E3 — Create a US state regulations message

```
Make sure you've placed the AdSense code on your site.
Messages may not be eligible to show on web if the referrer-policy isn't configured to share the "Referrer" header on cross-origin requests. Ensure that your referrer policy allows cross-origin sharing (for example, strict-origin or strict-origin-when-cross-origin).
```

### U-E4 — Create a display ad unit

```
To create a new display ad unit that you can manage within your account, follow these steps:
We recommend you leave Responsive selected. Responsive ads automatically adapt their size to fit your page layout and your users' devices. Learn more about the responsive behavior of display ad units .
If you prefer to specify the size of the ads that appear on your page, select Fixed and enter the required width and height. Note that fixed-sized ad units may have a limited pool of ads available, which might result in lower earnings than using responsive. For more information, refer to our guidelines for fixed-sized display ad units .
```

The steps between name the menu path: "Click Ads . Click By ad unit . Click Display ads ."

### U-E5 — How to modify your responsive ad code: exact sizes; external CSS not officially supported

```
Note : The examples described in this article are acceptable modifications of the AdSense ad code. You won't violate the AdSense Program policies by modifying your responsive ad code in these approved ways.
For screen widths up to 500px: a 320x100 ad unit.
For screen widths between 500px and 799px: a 468x60 ad unit.
For screen widths of 800px and wider: a 728x90 ad unit.
<ins class="adsbygoogle example_responsive_1 " style="display:block" data-ad-client=" ca-pub-1234567890123456 " data-ad-slot=" 8XXXXX1 "></ins>
(adsbygoogle = window.adsbygoogle || []).push({});
The @media rules are a CSS3 syntax, and are supported on all modern browsers. Note that setting the size of the ad unit via CSS in external style sheets is not officially supported.
```

### U-E6 — data-ad-status: unfilled units keep their size in the viewport

```
After an ad unit has finished requesting an ad, AdSense adds a parameter to the <ins> element called data-ad-status .
data-ad-status="filled"
An ad was returned to the ad unit and is now showing.
data-ad-status="unfilled"
No ads were returned and the ad unit is empty.
When AdSense ad units are " unfilled ", we try to either collapse the ad unit or show a blank space. We only collapse ad units when they are not going to cause page reflow, meaning only ad units outside of the viewport are collapsed. For all other unfilled ad units, we retain the ad unit size, and instead show a blank space.
```

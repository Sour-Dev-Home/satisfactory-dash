- 2026-11-01 — ADR-0021 amendment 3, build step 4, with the switch still off: with `ADS_ENABLED` "true" the Worker
  appends the AdSense loader (with the page's nonce) and a `satis-ads` marker to every HTML page's `<head>` and sends
  the finished ads-on CSP (Google's strict `script-src`; frames, images, fonts, media and connections opened to
  `https:`, inline styles allowed, `worker-src 'self'`, no `report-uri`). The app reads the marker: the shared footer
  gains "Privacy and cookie settings" (Google's revocation message), and Overview, Power, Factory and Planner get one
  fixed-size slot below their panels (tokens `--spacing-ad-*`; ad unit ids are placeholders in `src/ads/config.ts`
  until the owner creates them). No own "Do Not Sell or Share" link: Google's US message renders it on AdSense sites.
  Off, nothing is inserted or rendered. New captures `adsense-ad-units-and-us-states-link-2026-11-01.md` and
  `cloudflare-workers-htmlrewriter-content-2026-11-01.md`; new `e2e/ads-on.spec.ts` runs pages through the Worker with
  Google's hosts stubbed.

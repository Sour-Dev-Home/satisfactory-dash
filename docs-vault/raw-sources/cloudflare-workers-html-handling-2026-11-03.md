Source: Cloudflare Workers documentation, "Static assets routing: HTML handling", https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/ (page says "Last updated Apr 23, 2026")
Captured: 2026-11-03
Method: plain HTTPS GET of the page's Markdown version (`<page>/index.md`), the lines below copied unedited (lines between the quoted ones left out). No account sign-in.
Why it is here: ADR-0021's 2026-11-03 build note (static public pages). `cloudflare-workers-assets-worker-2026-11-01.md` E5 kept only the `/file` rows; this keeps the whole `auto-trailing-slash` table, which grounds where the build writes the guides (`dist/guides.html` served at `/guides`, `dist/guides/<slug>.html` at `/guides/<slug>`, `dist/changelog.html` at `/changelog`) and the landing page's file (`dist/landing.html` at `/landing`).

Summary (derived; the excerpts below are authoritative):
- With the default `auto-trailing-slash`, a file `x.html` is served at `/x` (200); `/x.html`, `/x/`, `/x/index` and `/x/index.html` redirect 307 to `/x` (HH-E2).
- A folder index `x/index.html` is served at `/x/` with a trailing slash, and `/x` redirects 307 to `/x/` (HH-E2). The build avoids folder indexes, so every public page has a slash-free URL.
- The table is for a `dist` holding `file.html` and `folder/index.html` (HH-E1). A file `guides.html` next to a folder `guides/` with no `index.html` in it is not shown: that `/guides` serves `guides.html` follows from the `/file` row but is [NEEDS VERIFICATION] in production (the e2e suite checks it under `vite preview` only).
- Nested paths (`/guides/getting-started` from `dist/guides/getting-started.html`) are not shown either; the same `/file` rule is assumed per path: [NEEDS VERIFICATION] in production.

### HH-E1 — the example directory structure

```
The [`assets.html_handling` configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#assets) determines the redirects and rewrites of requests for HTML content. It is used to specify the pattern for canonical URLs, thus where Cloudflare serves HTML content from, and additionally, where Cloudflare redirects non-canonical URLs to.
Take the following directory structure:
- dist
  - file.html
  - folder
    - index.html
```

### HH-E2 — Automatic trailing slashes (default)

```
## Automatic trailing slashes (default)
This will usually give you the desired behavior automatically: individual files (e.g. `foo.html`) will be served *without* a trailing slash and folder index files (e.g. `foo/index.html`) will be served *with* a trailing slash.
Based on the incoming requests, the following assets would be served:
| Incoming Request | Response | Asset Served |
| --- | --- | --- |
| /file | 200 | /dist/file.html |
| /file.html | 307 to /file | - |
| /file/ | 307 to /file | - |
| /file/index | 307 to /file | - |
| /file/index.html | 307 to /file | - |
| /folder | 307 to /folder/ | - |
| /folder.html | 307 to /folder | - |
| /folder/ | 200 | /dist/folder/index.html |
| /folder/index | 307 to /folder | - |
| /folder/index.html | 307 to /folder | - |
```

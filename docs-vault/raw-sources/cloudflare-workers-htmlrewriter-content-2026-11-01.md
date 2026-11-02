Source: Cloudflare Workers documentation, Runtime APIs: HTMLRewriter, https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/ (fetched as Markdown, `<page>/index.md`; page says "Last updated Apr 23, 2026")
Captured: 2026-11-01
Method: plain HTTPS GET of the page's Markdown version, the lines below grepped and copied unedited (lines between the quoted ones left out). No account sign-in. Only the excerpts this repo cites are kept, verbatim. Excerpt numbers are prefixed HR- to keep them apart from `cloudflare-workers-assets-worker-2026-11-01.md`'s E numbers (that capture, from the same page, has the constructor, `tagName`, `getAttribute`, `setAttribute` and selectors; it is immutable, so the insertion methods are added here).
Why it is here: ADR-0021 amendment 3, build step 4. The Worker inserts the AdSense loader and the ads marker into `<head>` while ADS_ENABLED is "true" (`frontend/worker/handle.ts`).
FINDINGS (as the page states them):
  - `append(content, contentOptions)` inserts content right before the element's end tag; `prepend` right after its start tag (HR-E1).
  - With `{ html: true }` the content is raw HTML; without it, it is text and is escaped (HR-E1).
NOT FOUND (recorded, not guessed):
  - Whether content inserted with `{ html: true }` is passed through the rewriter's own element handlers (so whether a `<script>` handler would see an inserted script). The Worker writes the nonce into the inserted tag itself, so it does not depend on either answer.

### HR-E1 — Content options and the insertion methods

```
- `Content` string | Response | ReadableStream
  - Content inserted in the output stream should be a string, [`Response`](https://developers.cloudflare.com/workers/runtime-apis/response/), or [`ReadableStream`](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestream/).
- `ContentOptions` Object
  - `{ html: Boolean }` Controls the way the HTMLRewriter treats inserted content. If the `html` boolean is set to true, content is treated as raw HTML. If the `html` boolean is set to false or not provided, content will be treated as text and proper HTML escaping will be applied to it.
- `prepend(content Content, contentOptions ContentOptions optional)` : `Element`
  - Inserts content right after the start tag of the element.
- `append(content Content, contentOptions ContentOptions optional)` : `Element`
  - Inserts content right before the end tag of the element.
```

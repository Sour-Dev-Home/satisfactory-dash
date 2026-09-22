# Lessons learned

Append-only list of real bugs found by independent `test-hunter` review passes, one
sentence per distinct bug so the same mistake isn't repeated in future code written
for this project. Each entry carries a `(×N)` counter: when a *later* review finds the
same underlying pattern recurring (even in a different file), increment that entry's
counter instead of adding a new line. Only add a new line for a genuinely new pattern.

## `backend/src/adapters/`

- (×1) A method that wraps its network call in try/catch to throw a typed error class
  must also wrap every subsequent step that can itself throw (JSON parsing, casting a
  response body) — otherwise a malformed-but-successful (2xx) response leaks a raw
  runtime exception (`SyntaxError`) instead of the typed error callers expect. Found in
  `FrmApiClient.get` (`frmApiClient.ts:56`, `res.json()` sat outside the try/catch).
- (×1) Guard functions that check "is this an error body" (e.g. `isErrorBody`) can
  correctly return `false` for a non-error value that is still unsafe to destructure —
  check explicitly for `null`/wrong-shape before casting and reading a property off a
  response body, rather than assuming "not an error body" implies "safe to read `.data`
  off of." Found in `VanillaApiClient.call` (`vanillaApiClient.ts:135`, crashed with a
  raw `TypeError` on a 2xx body that was JSON `null`).

## `backend/src/routes/`

- (×2) `String(err)` is not a reliable way to build an HTTP error response's diagnostic
  detail — it works for a plain `Error` (keeps the message) but silently drops all
  useful content for a Node `AggregateError` (e.g. the dual-stack/happy-eyeballs
  connect failure `https.request` throws when a host is unreachable), yielding a bare
  `"AggregateError"` with no cause. Prefer formatting `err.message` plus, for
  `AggregateError`, its `.errors` array, rather than blind `String(err)`. Found in
  `/api/status`'s catch block in `status.ts` (fixed with a shared `formatErrorDetail.ts`
  helper used by all three routes). **Recurred one level deeper in the fix itself**:
  `formatErrorDetail` unwraps `AggregateError.errors` with `.map((cause) => String(cause))`
  — a plain `String()`, not a recursive `formatErrorDetail()` call — so a *nested*
  `AggregateError` (one whose `.errors` contains another `AggregateError`) still
  collapses back to a bare `"AggregateError"` one level down. Not reachable by any
  current code path (no `Promise.any` usage in this codebase yet), so left as a
  documented failing test rather than fixed. Lesson generalizes: when writing a fix
  that recurses into a wrapper type's contents, actually recurse (call the same
  formatter on each nested item), don't just call the one-level-shallower primitive
  (`String()`) you're trying to replace.

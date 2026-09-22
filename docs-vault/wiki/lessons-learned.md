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

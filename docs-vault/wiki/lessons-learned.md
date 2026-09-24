# Lessons learned

Append-only list of real bugs and security findings found by independent `test-hunter`
and `security-reviewer` review passes, one sentence per distinct issue so the same
mistake isn't repeated in future code written for this project. Each entry carries a
`(×N)` counter: when a *later* review finds the same underlying pattern recurring
(even in a different file), increment that entry's counter instead of adding a new
line. Only add a new line for a genuinely new pattern.

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
- (×1) **Fixed in #17.** A TypeScript `as` cast on parsed JSON from a network response
  is compile-time only — it provides zero runtime safety, so code past that cast that
  dereferences fields or calls array methods without a shape guard will throw an
  uncaught `TypeError` on any malformed/unexpected response, rather than a typed,
  catchable error. Found in `satisfactoryServerAdapter.ts`: `getServerStatus()` read
  `raw.serverGameState.activeSessionName` unconditionally, and
  `getFactoryBuildings()`/`getPowerCircuits()`/`getPowerUsage()` all called
  `raw.map(...)` assuming FRM returned an array, with no guard against a response that
  didn't match the assumed shape. Fixed with zod schemas in `adapters/rawSchemas.ts`
  and a single `parseUpstream()` throw site that turns any mismatch into
  `UpstreamError(invalid_response)` → 502. (Found by `security-reviewer`.)
- (×1) **Fixed in #17.** A boolean security-relevant config flag that inverts an env
  var's name (e.g. `SATISFACTORY_API_REJECT_UNAUTHORIZED !== "true"` deciding *whether
  to allow* self-signed certs) defaulted to the permissive/insecure behavior unless the
  operator explicitly opted out, and wasn't scoped to when it's actually safe (e.g.
  only for a loopback/private host) — a config footgun once this project's stated
  "AWS later" non-local deployment happens. Found in `config.ts:41` →
  `vanillaApiClient.ts:78` (`rejectUnauthorized: !allowSelfSignedCert`, no host check).
  Fixed by flipping the default to verify-by-default, relaxed only for loopback/private
  address ranges; an explicit `"true"`/`"false"` (any case) still always wins. (Found by
  `security-reviewer`.)

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

## Domain assumptions (found by live captures, not review passes)

- (×1) A derived signal built only from documented fields must be checked against a
  live, populated response before it's trusted: the "backed up" rule required
  `IsProducing: true` plus a full output slot, but a machine with a full output *stops*
  producing, so the rule matched 0 of 71 backed-up machines on a real save. Found in
  `isBackedUp` (`services/productionService.ts:15`) by the 2026-09-22 captures.
- (×1) An empty list in an FRM response can mean "nothing right now" rather than
  "never has any": `OutputInventory` omits empty slots, so a machine with `[]` can still
  have an output buffer that fills up later. Don't infer a capability ("refineries have
  no output inventory") from a single snapshot showing `[]`. Found while checking the
  architecture brief's refinery claim against three 2026-09-22 captures.

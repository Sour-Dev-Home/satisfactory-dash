- **CI audit gate with dated exceptions** (owner, 2026-11-17). picomatch's high ReDoS advisory GHSA-fc5q-39xc-vjpf has
  no patched release, and `npm audit --audit-level=high` failed every PR's `security` job.
  - `scripts/audit-gate.mjs` replaces that step. It still fails on any high or critical advisory, except the ones listed in
    `.github/audit-exceptions.json`. Each exception names a GHSA id, the packages it covers, a reason, a `granted` date
    and an `expires` date at most 90 days after `granted`. It fails again the day after it expires, so renewing one shows
    up as a new `granted` date in the diff. Every waiver is a `::warning::` on the run, and an exception that is no longer
    reported gives a warning too. An unknown severity, or output the script can't parse, fails the job.
    (security-reviewer: the first version capped expiry from the run date, which let any PR renew forever.)
  - The only exception is GHSA-fc5q-39xc-vjpf, until 2026-12-17. picomatch is reached only through Vite, Vitest and
    tinyglobby at build and test time, so no production code runs it.

# ADR-0018: License: AGPL-3.0-only, relicensed from MIT

Status: accepted (project owner), 2026-09-24

## Context
The repository is public (DEPLOYMENT.md; portfolio value) and was MIT-licensed (LICENSE;
backend/package.json "license": "MIT"). ADR-0014 plans an optional paid managed-hosting service.
Under MIT, anyone can take the code and run a closed, competing hosted service. Options considered:
| Option | Effect |
|---|---|
| MIT (status quo) | Anyone may run a closed competing service; no reciprocity |
| AGPL-3.0 | Open source (OSI); anyone who runs a modified version as a network service must offer its source to users (§13); the copyright holder can still dual-license (e.g. sell a commercial license) |
| Source-available (ELv2 / BSL) | Bans competing hosted services outright, but isn't OSI open source (weaker portfolio and community signal) |
| Private repository | Protects the code but loses the portfolio value |

## Decision
Relicense to **AGPL-3.0-only** from the relicensing commit onward.
- LICENSE contains the full AGPL-3.0 text. The package.json files (root, frontend, backend,
  packages/shared) say "AGPL-3.0-only". The README has a license section.
- "-only" rather than "-or-later", so the copyright holder decides whether future GPL versions apply.
- **§13, network users:** the site shows a "Source code (AGPL-3.0)" link to the repository, ideally
  to the exact deployed commit if the build exposes its SHA [NEEDS VERIFICATION: Workers
  Builds commit variable]. The backend may add its version/commit to /api/health.
- **Keeping dual licensing possible:** external contributions require a contributor agreement.
  Either a CLA that grants relicensing rights, or DCO sign-off plus a written relicensing grant.
  Until one is in place, don't merge outside contributions (CONTRIBUTING.md says so).
  Dependabot's version bumps aren't copyrightable contributions.
- **Dependencies:** npm dependencies must be AGPL-compatible (MIT, BSD, Apache-2.0, ISC are fine).
  A license-check step can be added to CI when dependencies grow. SML (GPL-3.0) and FRM
  (unlicensed) run as separate programs inside the game, not linked into this code.

## Consequences
- Releases made under MIT before the relicensing commit stay MIT for anyone who already has them;
  this can't be revoked.
- Competitors may still self-host modified versions, but must publish their changes to their
  users. The owner can sell commercial licenses because they hold the copyright.
- The copyright line must name a holder able to grant a commercial license. The copyright
  holder is the owner, named in LICENSE (and only there), as the sole human author
  [NEEDS VERIFICATION with counsel: how AI-assisted commits affect authorship]. That's the one
  deliberate exception to the repo's no-personal-names rule, and CI's PII scan excludes only that
  file. Confirm with counsel before selling a license.
- Not legal advice. The LEGAL.md items (EULA/Content Usage Guidelines, FRM permission) stay open
  before any charging.

## Revisit when
- A commercial license is first sold, or an outside contributor appears (then CLA/DCO tooling).
- The service becomes a business entity (then transfer copyright to it).

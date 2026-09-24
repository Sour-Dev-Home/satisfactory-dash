# Legal status (unresolved — read before monetizing)

This is not legal advice. It's a record of what was checked and what wasn't, so a
future decision to charge money for this project is made deliberately rather than by
default.

## This repo's own code

Licensed **AGPL-3.0-only** (see `LICENSE` and ADR-0018) from the relicensing commit on.
Anyone who runs a modified version as a network service must offer its source to that
service's users (AGPL §13). Not legal advice.

- **Earlier versions stay MIT.** Commits up to and including
  `b9edbdb7e0ddb574ebcc574d9566ca666256dde2` (the last commit before the relicensing)
  were released under the MIT license, and anyone who already has them keeps that grant;
  it can't be revoked.
- **Dual licensing is still possible.** The copyright holder (named in `LICENSE`) can also
  offer commercial terms. Outside contributions would need a CLA, or a DCO sign-off plus a
  written relicensing grant, to keep that option, so none are accepted until one is set up
  (`CONTRIBUTING.md`, TODO for the owner).
- **Network use (§13):** the live site should link to this repository's source. That is a
  follow-up in the frontend, not part of the relicensing commit.
- **Still open, as before:** Satisfactory's EULA and Content Usage Guidelines, and FRM's
  license (see below). Relicensing doesn't settle either.

### Authorship evidence

Commits made after commit signing was enabled on 2026-09-23 are SSH-signed and show as
"Verified" on GitHub; earlier commits are by the GitHub account SourE-dev and aren't
signed. The relicensing commit gets a signed tag and a GitHub release, and the repository
is to be archived at Software Heritage. TODO before selling a license: register the
copyright with the US Copyright Office and confirm with counsel how AI-assisted commits
affect authorship.

## Dependency: FicsitRemoteMonitoring (FRM)

This project's backend is intended to call FRM's HTTP JSON API as a client — it does
not embed, fork, or redistribute FRM's own source code. FRM's documentation site
states it's GPLv3-licensed; the license of the mod's actual source code was not
independently confirmed at the time this was written (conflicting information was
found about the canonical repository). Because this project only consumes FRM's API
over the network rather than linking its code, GPL copyleft obligations most likely
don't extend to this repo's own code — but **verify the actual LICENSE file in FRM's
repository before relying on this**, and re-check if this project ever vendors,
forks, or embeds any FRM code directly (that would change the analysis).

## Satisfactory's own EULA / IP

Not independently confirmed. What's known: Coffee Stain Studios (the developer)
publicly tolerates and supports a community modding ecosystem (ficsit.app), and
multiple monetized third-party Satisfactory tools already exist without apparent
enforcement action — which is evidence of practical tolerance, not a legal guarantee.
**Read Satisfactory's actual EULA directly from an official source (the game's Steam/
Epic store page or Coffee Stain's own site) before committing to any monetization
plan.**

## Working rules until this is resolved

- Never bundle or redistribute Satisfactory or FRM assets/code in anything shipped.
- Never use Coffee Stain's trademarks/branding in this project's name, logo, or
  marketing.
- Treat "can I charge for this" as an open question, not a blocker for building it —
  the code and its license (AGPL-3.0-only) don't depend on the answer. Revisit this file with
  real sources (not a web search) before turning on billing.

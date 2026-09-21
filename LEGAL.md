# Legal status (unresolved — read before monetizing)

This is not legal advice. It's a record of what was checked and what wasn't, so a
future decision to charge money for this project is made deliberately rather than by
default.

## This repo's own code

Licensed MIT (see `LICENSE`). Permissive, doesn't lock in a business model, standard
choice for this kind of tool.

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
  the code and its license (MIT) don't depend on the answer. Revisit this file with
  real sources (not a web search) before turning on billing.

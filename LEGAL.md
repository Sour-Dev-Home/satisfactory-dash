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

**Owner's risk acceptance (2026-10-24, ADR-0051 questions 2 and 4):** the owner decided not to ask FRM's maintainer
for a licence statement or Coffee Stain for written terms ("not gonna ask, not expected within the community"). The
public release goes ahead under ficsit.app's community norms on that accepted risk. Declaring FRM as a `.uplugin`
dependency only names it for SMM to install; the mod and this repo still never bundle, fork or redistribute FRM's
code. Any monetization decision revisits this.

## Satisfactory's own EULA / IP

Not independently confirmed. What's known: Coffee Stain Studios (the developer)
publicly tolerates and supports a community modding ecosystem (ficsit.app), and
multiple monetized third-party Satisfactory tools already exist without apparent
enforcement action — which is evidence of practical tolerance, not a legal guarantee.
**Read Satisfactory's actual EULA directly from an official source (the game's Steam/
Epic store page or Coffee Stain's own site) before committing to any monetization
plan.**

**Game icons (#571, 2026-10-21; building icons added 2026-10-24):** the map draws resource nodes, and the Planner
draws buildings (graph cards and the group panel), with the game's own icons, exported by the
owner from their game install and kept in `frontend/public/game-assets/`. They are © Coffee Stain Studios,
used as fan content in a free, non-commercial tool, **not** covered by this repo's AGPL-3.0-only licence, and
removed on request. `frontend/public/game-assets/NOTICE.md` states the boundary. This amends the "never
bundle Satisfactory assets" working rule below for those icons only; it does not settle the EULA question
above, and any monetization decision must revisit it.

**Map terrain (#571, 2026-10-26):** the Map page's base draws shapes traced from the game's own world map texture
(`frontend/src/map/terrain/`, see its NOTICE.md). The texture is not in the repo; the derived shapes have the same
standing as the icons above: © Coffee Stain Studios' map, fan content, not AGPL, removed on request
(`TERRAIN_ENABLED`).

## The game mod (ADR-0039)

**This is a reading of the licence texts for planning, not legal advice.** It records what the texts say so the
build ADR (ADR-0039 G3) can cite it; nobody qualified to advise has reviewed it. Every line cites a source under
`docs-vault/raw-sources/` (GPL-3.0 sections are cited from the verbatim text in `sml-license-2026-09-27.txt`) or a
file in this repository. Issue #471.

### The setup

- The mod is its own repository, `Sour-Dev-Home/satisfactory-dash-mod`, public and GPL-3.0-or-later (owner decision,
  2026-09-27, `docs-vault/wiki/mod-claims.md` "The mod repository"; ADR-0039 decision 5 and D3). None of this
  repository's code goes into it.
- It is built against SatisfactoryModLoader (SML), whose licence file is the unmodified GPL-3.0 text, with no
  statement choosing "only" or "or later" (`sml-license-2026-09-27.txt`, findings).
- It ships as a binary through ficsit.app, the Satisfactory Mod Repository (owner, 2026-10-20, issue #471), where a
  C++ mod passes an automated approval before download (`ficsit-app-mod-rules-2026-10-20.md` E5).
- It talks to the AGPL-3.0-only backend (`LICENSE`) only over HTTP, sending the same agent contract the edge agent
  sends today (`packages/shared/src/agent.ts`; ADR-0039 Consequences: "the agent-input contract is already the mod's
  contract"). No code is linked or shared between the two at build or run time.

### What GPL-3.0 asks of the mod

- **Its own licence.** The mod compiles against SML and runs loaded into the same game process. The FSF reads modules
  "designed to run linked together in a shared address space" as "almost surely" one program (`gpl-faq-2026-10-20.md`
  E1), and dynamically linked plug-ins that call each other and share data structures as "a single combined program"
  (E2), which must be licensed "under the GPL or a GPL-compatible free software license" (E3). GPL-3.0 §5(c): "You
  must license the entire work, as a whole, under this License". The mod's GPL-3.0-or-later meets this whichever
  version SML means: §14 lets a work that names no version be used under "any version ever published".
- **Its binary distribution.** Conveying object code requires conveying "the machine-readable Corresponding Source"
  (§6). For a download from a network server, §6(d) allows "equivalent access to the Corresponding Source in the same
  way through the same place", or on another server with "clear directions next to the object code saying where to
  find the Corresponding Source". The FSF adds that the source "must correspond exactly to the binaries", same version
  (`gpl-faq-2026-10-20.md` E6). Corresponding Source includes the "scripts to control" building and installing (§1).
  In practice: every ficsit.app release carries the source link (ficsit.app's upload form has the field,
  `ficsit-app-mod-rules-2026-10-20.md` E4) pointing at the tagged commit that built it, with the build scripts in that
  repository.
- **Notices.** Each copy keeps the copyright and licence notices and gives "all recipients a copy of this License
  along with the Program" (§4, applied to modified versions by §5), so the packaged mod includes the licence text.

### Does talking over HTTP make the web app a derivative of the mod or of SML?

- **The texts read as no.** GPL-3.0 does not extend to "separate and independent works, which are not by their nature
  extensions of the covered work, and which are not combined with it such as to form a larger program" (§5, the
  "aggregate" paragraph). The FSF: "pipes, sockets and command-line arguments are communication mechanisms normally
  used between two separate programs", unless "the semantics of the communication are intimate enough, exchanging
  complex internal data structures" (`gpl-faq-2026-10-20.md` E1); separate programs must "communicate at arms length"
  (E5). The backend and the mod exchange one documented, versioned JSON contract (`packages/shared/src/agent.ts`),
  which a separate program, the edge agent, already speaks. Neither side's internal data structures cross it.
- **The same reading runs the other way:** the mod is not a derivative of the AGPL-3.0-only backend, for the same
  reason.
- **If a court ever saw them as one work,** GPL-3.0 §13 gives "permission to link or combine any covered work with a
  work licensed under version 3 of the GNU Affero General Public License into a single combined work". The FSF also
  notes that where the line falls "is a legal question, which ultimately judges will decide" (E1).

### What Coffee Stain's captured terms say

- **Nothing yet, because no terms were found.** No Coffee Stain EULA or modding policy for Satisfactory was found at
  any URL a script can reach, on 2026-09-27 or again on 2026-10-20. Coffee Stain's legal archive lists EULAs for other
  titles only, and Steam's EULA page for the game returns an error (`coffee-stain-mod-terms-2026-10-20.md` findings,
  E1, E2; `coffee-stain-mod-terms-2026-09-27.md`). So no captured source says what Coffee Stain allows for
  **distributing mods** or for **mods that send data off the server**.
- **What the game itself ships:** Coffee Stain's own dedicated-server documentation has a "Modded" server flag, fields
  "used by the mods or custom servers", and a health check that passes data "between Modded Dedicated Server and
  Modded Game Client" (`coffee-stain-mod-terms-2026-10-20.md` E3 to E5). That shows the game is built to accommodate
  modded servers. It is not a licence term and grants nothing.
- **The platform's rules (ficsit.app's, not Coffee Stain's):** a mod must state every external network connection in
  its "Network Activity Transparency" section (`ficsit-app-mod-rules-2026-10-20.md` E1), must state AI use in its
  creation, including "source code ... directly created by generative AI models" (E2), and cannot lock features
  behind payment (E3). The SML docs remind modders that the game's assets are Coffee Stain's copyright (E6).

### Open points

- **Coffee Stain's EULA text** [NEEDS VERIFICATION]: what it says about mods, reverse engineering, distributing mods,
  and mods sending data off the server. Settled by the owner saving the EULA the game shows at install or in the
  Steam/Epic launcher into `docs-vault/raw-sources/`, dated, or by a written answer from Coffee Stain (the route
  ADR-0038 uses for the map image).
- **The mod also links the game's own, proprietary code** [NEEDS VERIFICATION]. The FSF says a GPL plug-in that forms
  one program with a nonfree main program "would violate the GPL", unless the plug-in's licence adds an exception
  permitting that link (`gpl-faq-2026-10-20.md` E4). SML is in the same position, and its repository states no such
  exception (`sml-license-2026-09-27.txt`, findings); whether the game counts as a "System Library" (§1) is not
  stated by any source. Settled by an answer from SML's maintainers on how they read it, and an owner decision on
  whether the mod's own code carries a linking exception for the game (the owner can add one only for code they hold
  the copyright in, not for SML's).
- **"Intimate" communication** [NEEDS VERIFICATION]: the FSF leaves the line to judges (E1). The reading above holds
  while the contract stays a documented, versioned schema that a separate program also speaks. Settled only by
  counsel; until then, keep it that way.
- **The FSF FAQ text** [NEEDS VERIFICATION]: gnu.org was unreachable when it was captured, so the excerpts come from a
  pinned mirror of the page (`gpl-faq-2026-10-20.md`, header). Settled by comparing them with the live page.
- **Player data sent by the mod** [NEEDS VERIFICATION]: the snapshot includes player names (`PlayerSchema`, via
  `packages/shared/src/agent.ts`). ficsit.app's disclosure rule (E1) covers it on the platform's side; whether
  Coffee Stain's terms restrict it is the EULA point above. Settled by that EULA read, plus an owner check of the privacy
  policy (`frontend/public/privacy.html`) against the mod as a new source of the same data before it ships.

## Working rules until this is resolved

- Never bundle or redistribute Satisfactory or FRM assets/code in anything shipped. (Amended by #571: the map's resource icons are the one exception, see "Game icons" above.)
- Never use Coffee Stain's trademarks/branding in this project's name, logo, or
  marketing.
- Treat "can I charge for this" as an open question, not a blocker for building it —
  the code and its license (AGPL-3.0-only) don't depend on the answer. Revisit this file with
  real sources (not a web search) before turning on billing.

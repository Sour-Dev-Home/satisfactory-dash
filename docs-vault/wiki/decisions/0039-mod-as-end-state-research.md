# ADR-0039: A game mod as the end-state data source: explore behind evidence gates

Status: accepted (owner, 2026-09-27) for card #332. D1: explore now, running gates G0-G2 as
portfolio exploration; there is no build (G3) without the owner's explicit go. D2: our own SML
mod (option C), without asking the FRM maintainer first. D3: spike code lives in a separate
repository, whose name, visibility and licence the owner approves before it is created. This ADR
makes **no claim about mod APIs as fact**: every such statement is either cited to something
checkable today, or marked [NEEDS VERIFICATION] and becomes a gate.

## Context
- **No data gap needs a mod.**
  - `wiki/data-gap-analysis.md` (spike of 2026-09-21: game 1.2.4.0, SML 3.12.0, FRM 1.5.3) says:
    "No row currently needs a custom mod: every stated metric has a documented, reachable API
    source."
  - #334's volume pass found every map layer #330 wants among FRM endpoints.
  - So the case for a mod is **packaging and reach, not data**: one install on the game server
    instead of a separate agent program.
- **Where the agent can't run.**
  - The agent (ADR-0031) is a Node program beside the game server.
  - A player whose server is rented from a game host usually can't run a second program there, but
    game hosts do offer mod installs. Hosting pages list FRM as an installable mod, e.g. Mado
    Hosting's FRM page (mado-hosting.com/satisfactory-mods/FicsitRemoteMonitoring).
    [NEEDS VERIFICATION: which hosts allow which mods, and whether outbound HTTPS from the game
    process is allowed there.]
  - Polling a hosted FRM from the backend would mean exposing FRM's web server publicly, and its
    read API needs no token (#334 captured it over loopback with none). So hosted servers need a
    **push from inside the game process**. That's the real trigger for a mod.
- **Licensing, as checked today (2026-09-27, GitHub's license API):**
  - SatisfactoryModLoader: **GPL-3.0**.
  - FicsitRemoteMonitoring: **no license detected** by GitHub (the license endpoint returns 404)
    [NEEDS VERIFICATION: the license, if any, before reading or reusing FRM code].
  - satisfactory-dash is AGPL-3.0-only (ADR-0018). Compatibility of a GPL-3.0-linked mod with this
    project [NEEDS VERIFICATION: a legal read, recorded in `LEGAL.md`].
  - Coffee Stain's EULA and stance on mods [NEEDS VERIFICATION: capture into raw-sources].
- **An outbound HTTP client inside a mod is plausible but unproven for us.** A GitHub code search
  for `FHttpModule` in the FRM repository returns one file (2026-09-27), which suggests UE's HTTP
  module is usable from a Satisfactory mod. [NEEDS VERIFICATION: what that code does, on which
  game/SML version, and on a dedicated server.]

## Options
| | What | Upside | Cost / risk |
|---|---|---|---|
| **A** | Keep the agent (today) | Works now, no UE toolchain, fully ours | Can't reach rented game servers |
| **B** | Propose an **outbound push** to FRM upstream (a configured URL plus a token, posting what it already reads) | No new mod. FRM already follows game patches. The backend's agent-ingest contract can be the target | Depends on the FRM maintainer's interest and FRM's licence. The shape is theirs |
| **C** | Our own SML mod that posts the existing agent-input contract (`packages/shared/src/agent.ts`) | Fully ours; the contract and enrolment are reused (the mod is just another agent, `agentVersion: "mod/x.y"`) | A C++/UE5 toolchain; a rebuild per game/SML release [NEEDS VERIFICATION: how often SML breaks mods]; GPL obligations |

## Decision
1. **Explore now, build later.** Gates G0-G2 run now as portfolio exploration. **Ground rule 4
   stays**, with one sentence added: "A mod replaces the agent only after the ADR-0039 gates pass
   and the owner approves a build ADR (G3)." The agent remains the supported path until then.
2. **Option C, our own SML mod.** Option B (an upstream push in FRM) isn't pursued. The mod is
   another agent implementation: it posts the existing agent-input contract, enrols with the same
   code flow, and identifies itself as `agentVersion: "mod/x.y"`. The backend doesn't change for
   the spikes.
3. **The trigger for G3** (when a build becomes worth proposing) is still the one in the Context: a
   player whose rented game server can't run the agent. The exploration doesn't wait for it.
4. **The anti-invention gates** (the owner's concern). Each gate's evidence is committed before the
   next gate starts:
   - **G0: capture.** Save the sources we'd rely on into `docs-vault/raw-sources/`, dated and with
     their URLs:
     - the SML docs pages on C++ mods and dedicated servers;
     - the UE HTTP-module reference for the engine version the game ships
       [NEEDS VERIFICATION: which UE version];
     - FRM's licence and the file(s) using `FHttpModule`, only if its licence allows reading them
       for reuse;
     - Coffee Stain's modding terms.
     - No mod-API statement enters an ADR without one of these.
   - **G1: a claims table.** Keep one table in this ADR: claim | raw-source | verified on a real
     server (date, game/SML version) | spike. Every "the mod can X" is a row. A row without a
     source is [NEEDS VERIFICATION] and can't be designed on.
   - **G2: spikes on the owner's real dedicated server, one claim each, smallest first.**
     - (a) A mod that loads and logs a line.
     - (b) One HTTPS POST of a fixed JSON to a local echo server at startup.
     - (c) A timer that posts every 30 s without a tick-rate drop (tick card before and after).
     - (d) Reading one value the snapshot needs (e.g. power) through the documented API.
     - (e) Storing a credential in the mod's config, not readable by other players
       [NEEDS VERIFICATION].
     - Each spike's log output and the echo server's capture go into raw-sources. A failed spike
       ends option C, or changes the design, before any build.
   - **G3: a build decision.** Only with G0-G2 complete does a follow-up ADR propose building B or C.
5. **Where spike code lives:** a separate repository (D3). That keeps the UE toolchain, large binaries
   and GPL-linked code out of the AGPL web app, and keeps CI fast. The raw-sources and the claims
   table stay in this repo's `docs-vault/`, so the evidence sits beside the ADRs it supports.

## Consequences
- UE work happens only as spikes. The agent stays the supported path, and the agent-input contract
  is already the mod's contract, so nothing built today is wasted.
- The owner's concern is addressed by the process itself: a mod API claim can't reach a design
  without a captured source and a passing spike on a real server.

## Revisit when
- The trigger happens (a rented server that can't run the agent).
- The FRM maintainer announces an outbound or push feature.
- SML or the game changes how dedicated-server mods load (re-run G2 (a) and (b)).

## Owner decisions (2026-09-27)
- **D1** Explore now: G0-G2 as portfolio exploration. There's no build (G3) without the owner's go.
- **D2** Our own mod (C). No request to the FRM maintainer first.
- **D3** Spike code in a separate repository. The owner approves its name, visibility and licence
  before it's created.

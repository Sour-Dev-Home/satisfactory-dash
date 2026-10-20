# ADR-0042: Build the mod (ADR-0039 G3)

Status: proposed (the owner accepts it by approving this PR; ADR-0039 D1). Issue #473. Until it is
accepted, nothing is built and ADR-0039 stands as it is.

## Context
- **G0–G2 are complete.** Claims C1–C7 are all `verified` on the owner's test install, each on a
  spike bundle under `raw-sources/mod-spikes/` ([`mod-claims.md` "The claims"](../mod-claims.md#the-claims)
  and "G3 readiness"). They cover loading on a dedicated server (C1), HTTP and HTTPS with certificate
  verification (C2, C3), a 30 s timer without a tick-rate drop (C4), power circuits matching FRM (C5),
  a server-side credential (C6), and enrolling and pushing a snapshot to a local backend (C7). Only
  those verified rows are relied on below; C8 and C9 are new, unverified, and gate the build.
- **The owner's goal replaces decision 3's trigger.** ADR-0039 decision 3 kept G3 until "a player
  whose rented game server can't run the agent". The owner un-parked G3 with their own goal instead:
  "I want to be able to move the agent from my computer to the mod" (owner, 2026-10-20).
- **The design is approved.** The owner approved the core mod's design,
  `docs/specs/2026-10-20-core-mod-v1-design.md` in `satisfactory-dash-mod` at merge commit `14fae53`
  (mod PR #19; owner, 2026-10-20). This ADR records the decision to build it; the spec holds the
  detail.
- **The owner's choices for it:**
  - The mod ships to other players through ficsit.app and must work on rented hosts (owner,
    2026-10-20).
  - It replaces the Node agent, which is deprecated after parity (owner, 2026-10-20).
  - A hybrid data source: status, power and auto-pause are native in v1; the factory, map and world
    layers come from FRM later, then go native one layer per release (owner, 2026-10-20).
  - Native status and auto-pause are built only after spikes C8 and C9 pass (owner, 2026-10-20).
  - The secret is kept in `FactoryGame/Saved/SatisDash/credential.json`, apart from the config,
    which holds only the backend URL and a one-time code that the mod blanks after enrolling
    (owner, 2026-10-20).

## Decision
Build option C as the **core mod v1**, as the spec at `14fae53` defines it.

The mod is another agent on the existing `/agent/v1` contract (`packages/shared/src/agent.ts`),
identifying itself as `agentVersion: "mod/x.y"`, so **the backend doesn't change** (ADR-0039
decision 2, ADR-0031).

The sub-projects, in order:
1. **G3 prep** (#471, #472): the licence reading and the SML and hosts research.
2. **The core mod v1:** status, power and auto-pause read natively, pushed on the agent contract.
3. **The FRM bridge:** the factory, map and world layers read from FRM.
4. **Distribution:** Windows and Linux builds in CI, the ficsit.app listing, and a host guide.
5. **Switchover** to the mod, and the Node agent's deprecation.
6. **Native readers** that replace FRM, one layer per release.

## Gates that still hold
- **C8 (native status) and C9 (native auto-pause)** pass as harness-written spikes, recorded in
  `mod-claims.md` as for C1–C7, before any build code.
- **v1 is done** only when the spec's unit tests, its harness runs and a 30-minute parity run
  against the Node agent all pass.
- **The Node agent stays the supported path** until sub-project 5.

## Named risks
- **The GPL/AGPL reading and Coffee Stain's terms**
  ([#471](https://github.com/Sour-Dev-Home/satisfactory-dash/issues/471)). The reading is in
  [`LEGAL.md` "The game mod (ADR-0039)"](../../../LEGAL.md#the-game-mod-adr-0039); its open points
  (the EULA text, the mod linking the game's proprietary code, player data the mod sends) stay
  [NEEDS VERIFICATION] there.
- **SML's breakage rate, and hosts allowing custom mods with outbound HTTPS**
  ([#472](https://github.com/Sour-Dev-Home/satisfactory-dash/issues/472)). Both are in
  [`mod-maintenance.md`](../mod-maintenance.md); no host's docs state outbound network access, so
  that stays [NEEDS VERIFICATION].
- **FRM as the mod's runtime dependency.** From sub-project 3 until sub-project 6 the mod reads the
  factory, map and world layers from FRM, so FRM must be installed beside it, and FRM's own licence
  is still unconfirmed ([`LEGAL.md` "Dependency: FicsitRemoteMonitoring (FRM)"](../../../LEGAL.md#dependency-ficsitremotemonitoring-frm)).
- A risk that #471 or #472 finds blocking **reopens this ADR before distribution** (sub-project 4).

## Consequences
- Ground rule 4 in `CLAUDE.md` changes only once the owner accepts this ADR, in its own change.
- The mod repository holds the build; none of this repository's code goes into it (LEGAL.md "The
  setup"). This repository changes only where the switchover (sub-project 5) needs it.

## Revisit when
- #471 or #472 lands. (Both landed on 2026-10-20, before this ADR, and are read above; their open
  [NEEDS VERIFICATION] points are what can still reopen it.)
- C8 or C9 fails: the spec's loopback fallback goes back to the owner.
- SML or the game changes how dedicated-server mods load.

# Mod maintenance: SML's breakage history and which hosts allow a custom mod

G3 prep for ADR-0039 (issue #472): "G3 readiness" items 3 and 4 in [`mod-claims.md`](./mod-claims.md). The mod would ship
to other players through ficsit.app and must work on rented hosts (owner, 2026-10-20). This page records, from captured
sources only, how often a game update needed a new SML release, and what rented hosts say about installing a custom mod.
It decides nothing; a build ADR carries what is left open here as named risks.

Sources (all in `raw-sources/`, captured 2026-10-20):

- **patch**: `satisfactory-patch-history-2026-10-20.md`, the game's patches from the Satisfactory Wiki, each with
  Coffee Stain's Steam announcement.
- **sml**: `sml-releases-2026-10-20.md`, SML's GitHub release notes and ficsit.app's minimum game build per SML release.
- **hosts**: `game-hosts-mods-2026-10-20.md`, five hosts' "install mods" pages.

## SML across game updates

The window is the two years to 2026-10-20 (from 2024-10-20). The table starts at 1.0 (2024-09-10), just before it,
because the SML line the window opens on (3.8.0) is 1.0's.

**SML release for it** reads:

- **Yes, stated**: an SML release note names this update or build as newly supported (and, for 3.11.x, says the
  previous game version no longer works with it).
- **Header update**: an SML release updated its headers or stubs to this build, without saying the update was required.
- **No**: no SML release names this update or build. That the SML release of the day kept working on it is not stated
  anywhere captured; ficsit.app only records a minimum build per SML release (sml E11), so treat those rows as
  [NEEDS VERIFICATION].

**Gap** is days from the patch date to the SML release's publish date. S is the stable branch, X Experimental.

| Date | Game patch | Br | Build | SML release for it | Gap (days) | Sources |
|---|---|---|---|---|---|---|
| 2024-09-10 | 1.0 | S | 365306 | Yes, stated: 3.8.0 "Satisfactory 1.0 release support"; minimum build 365306 | 30 | patch E1, E2; sml E1, E10, E11 |
| 2024-09-12 | 1.0.0.1 | S | 366202 | No | — | patch E2; sml E1 |
| 2024-09-19 | 1.0.0.2 | S | 367101 | No | — | patch E2; sml E1 |
| 2024-09-25 | 1.0.0.3 | S | 368883 | Header update: 3.8.0 "Updated project to CL368883" | 15 | patch E2; sml E1, E10 |
| 2024-10-15 | 1.0.0.4 | S | 372858 | No | — | patch E2; sml E1 |
| *2024-10-20* | *window starts* | | | | | |
| 2024-11-04 | 1.0.0.5 | S | 377620 | No | — | patch E2; sml E1 |
| 2024-11-07 | 1.0.0.6 | S | 378208 | No | — | patch E2; sml E1 |
| 2024-11-14 | 1.0.0.7 | S | 379322 | No | — | patch E2; sml E1 |
| 2024-11-28 | 1.0.1.0 | S | 382498 | Header update: 3.9.0 "Content stubs to CL382498" | 19 | patch E2; sml E1, E9 |
| 2024-12-03 | 1.0.1.1 | S | 383233 | No | — | patch E2; sml E1 |
| 2024-12-05 | 1.0.1.2 | S | 383729 | Header update: 3.9.0 "Headers to CL383729"; minimum build 383729 | 12 | patch E2; sml E1, E9, E11 |
| 2024-12-09 | 1.0.1.3 | S | 384038 | No | — | patch E2; sml E1 |
| 2024-12-20 | 1.0.1.4 | S | 385279 | No | — | patch E2; sml E1 |
| 2025-02-18 | 1.0.1.5 | X | 395236 | No | — | patch E1, E2; sml E1 |
| 2025-03-11 | 1.0.1.6 | X | 399795 | No | — | patch E1, E2; sml E1 |
| 2025-04-01 | 1.1.0.0 | X | 403662 | Yes, stated: 3.11.0 "Satisfactory 1.1 (Experimental) support", "will only work on 1.1 … and not 1.0" | 58 | patch E1, E2; sml E1, E6 |
| 2025-04-04 | 1.1.0.1 | X | 404250 | Header update: 3.11.0 "Content stubs to CL404250" | 55 | patch E2; sml E1, E6 |
| 2025-04-09 | 1.1.0.2 | X | 404994 | No | — | patch E2; sml E1 |
| 2025-04-17 | 1.1.0.3 | X | 406341 | No | — | patch E2; sml E1 |
| 2025-05-12 | 1.1.0.4 | X | 410840 | Yes, stated: 3.11.0 "game CL must be >= 410840" | 17 | patch E2; sml E1, E6, E11 |
| 2025-06-02 | 1.1.0.5 | X | 415558 | Yes, stated: 3.11.1 "Satisfactory v1.1.0.5 (Experimental) support", "game CL must be >= 415558" | 3 | patch E2; sml E1, E5, E11 |
| 2025-06-09 | 1.1.0.6 | X | 416835 | Header update: 3.11.2 "Headers to CL416835" | 53 | patch E2; sml E1, E4 |
| 2025-06-10 | 1.1.1.0 (1.1 on stable) | S | 416835 | Header update: 3.11.2 "Headers to CL416835"; 3.11.1 (minimum build 415558) was already out 5 days before | 52 | patch E1, E2; sml E1, E4, E11 |
| 2025-06-18 | 1.1.1.1 | S | 418783 | No | — | patch E2; sml E1 |
| 2025-07-17 | 1.1.1.2 | S | 424353 | No | — | patch E2; sml E1 |
| 2025-09-02 | 1.1.1.3 | S | 432215 | No | — | patch E2; sml E1 |
| 2025-09-08 | 1.1.1.4 | S | 433351 | No | — | patch E2; sml E1 |
| 2025-10-07 | 1.1.1.5 | X | 442229 | No | — | patch E1, E2; sml E1 |
| 2025-10-10 | 1.1.1.6 | X | 445319 | No | — | patch E1, E2; sml E1 |
| 2025-11-11 | 1.1.1.7 | S | 455399 | No | — | patch E2; sml E1 |
| 2025-11-26 | 1.1.2.0 | S | 458806 | No | — | patch E2; sml E1 |
| 2025-12-01 | 1.1.2.1 | S | 460533 | No | — | patch E2; sml E1 |
| 2025-12-19 | 1.1.2.2 | S | 463028 | No | — | patch E2; sml E1 |
| 2026-02-10 | 1.1.3.0 | X | 472072 | No | — | patch E1, E2; sml E1 |
| 2026-02-19 | 1.1.3.1 | X | 474567 | No | — | patch E1, E2; sml E1 |
| 2026-03-17 | 1.2.0.0 | X | 480321 | Yes, stated: 3.12.0 "Satisfactory 1.2 (CL#491125) support", the first release naming 1.2 | 81 | patch E1, E2; sml E1, E2 |
| 2026-03-24 | 1.2.1.0 | X | 481836 | No | — | patch E2; sml E1 |
| 2026-04-28 | 1.2.2.0 | X | 488068 | No | — | patch E2; sml E1 |
| 2026-05-07 | 1.2.2.1 | X | 489969 | No | — | patch E2; sml E1 |
| 2026-05-19 | 1.2.2.2 (Experimental) | X | 491125 | Yes, stated: 3.12.0 "Satisfactory 1.2 (CL#491125) support"; minimum build 491125 | 18 | patch E2; sml E1, E2, E11 |
| 2026-06-02 | 1.2.2.2 (1.2 on stable) | S | 491125 | Yes, stated: 3.12.0, as above | 4 | patch E1, E2; sml E1, E2, E11 |
| 2026-06-11 | 1.2.3.0 | S | 493833 | No | — | patch E2; sml E1 |
| 2026-06-24 | 1.2.3.1 | S | 495413 | No | — | patch E2; sml E1 |
| 2026-08-11 | 1.2.4.0 (and 1.2.4.1) | S | 502094 | No | — | patch E1, E2; sml E1 |

### What this means for the mod's upkeep

In the window's 39 patches, an SML release named 6 of them as newly supported, all at the opening of a major update or
its Experimental patches (1.1.0.0, 1.1.0.4, 1.1.0.5, 1.2.0.0 and both 1.2.2.2 rows), and updated its headers to 5 more
(1.0.1.0, 1.0.1.2, 1.1.0.1, 1.1.0.6, 1.1.1.0); the other 28, hotfixes and mid-cycle Experimental patches, had no SML release naming them. Each
"Yes, stated" release came with a guide for mod developers to update their mods (sml E2, E6), and 3.11.0 and 3.11.1 say
1.0 no longer works with them (rows 1.1.0.0, 1.1.0.5), so the mod should expect one rebuild against new SML per major
update: so far one a year (1.0 in September 2024, 1.1 in June 2025, 1.2 in June 2026 on stable). Stable-branch players
waited 30 days for SML on 1.0, had a release out 5 days before 1.1 reached stable (3.11.1, though only 3.11.2 52 days
later updated to that exact build) and waited 4 days on 1.2; Experimental players waited 58 days (1.1.0.0) and 81 days
(1.2.0.0). A mod released for stable can plan on a rebuild within days to a month of each major update, and no
support on Experimental for up to about three months. Whether any of the 28 "No" patches broke mods anyway is
[NEEDS VERIFICATION].

## Rented hosts and custom mods

Five hosts with public mod docs (hosts, header). Shockbyte's page refused a scripted fetch (HTTP 403), so it is not in
the table. "From ficsit.app" means the host documents installing ficsit.app mods; "uploaded" means it documents
uploading a mod that is not on ficsit.app.

| Host | Custom mods allowed (from ficsit.app or uploaded) | Outbound network from the game process stated | Source |
|---|---|---|---|
| Nodecraft | From ficsit.app: yes, SMM over SFTP. Uploaded: [NEEDS VERIFICATION] | [NEEDS VERIFICATION] | hosts E1 |
| GameServerKings | From ficsit.app: yes, SMM over SFTP, or a manual SFTP upload of a mod's LinuxServer build from ficsit.app; the host says it has not run SMM against its servers itself. Uploaded: [NEEDS VERIFICATION] | [NEEDS VERIFICATION] | hosts E2, E3, E4 |
| LOW.MS | From ficsit.app: yes, a panel mod manager or SMM over SFTP. Uploaded: yes, "a mod that is not yet on ficsit.app – the SFTP path still works" | [NEEDS VERIFICATION] | hosts E5, E6 |
| Game Host Bros | From ficsit.app: yes, SMM over SFTP. Uploaded: [NEEDS VERIFICATION] | [NEEDS VERIFICATION] | hosts E7, E8 |
| XGamingServer | From ficsit.app: yes, SMM; manual SFTP upload of SML and mods as a fallback. Uploaded: [NEEDS VERIFICATION] | [NEEDS VERIFICATION] | hosts E9, E10 |

Two things for a build ADR follow from the table. Every host documents ficsit.app mods, so shipping through ficsit.app
is the path all five name; and GameServerKings runs the Linux server build (hosts E3, E4), so the mod needs a Linux
server target as well as Windows. No host's page says whether the game process may open outbound HTTPS, which is the
mod's whole job (ADR-0039 Context); it stays [NEEDS VERIFICATION] until a host's support answers it or a test on a rented
server shows it.

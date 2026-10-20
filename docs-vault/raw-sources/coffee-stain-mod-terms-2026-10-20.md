Source: the Coffee Stain, Satisfactory and Steam URLs listed below, and the game's own shipped file `CommunityResources/DedicatedServerAPIDocs.md` from a local Steam install of Satisfactory (standard library location, Steam/steamapps/common/Satisfactory; Steam build id 25782416)
Captured: 2026-10-20
Method: curl of each URL with a browser user agent (HTTP status recorded); Coffee Stain's WordPress sitemaps listed in full; the local install searched for any EULA, licence or terms file; the shipped API document read for every mention of mods.
Excerpts only: The shipped API document is Coffee Stain's and carries no licence that permits redistributing it, so only quoted excerpts are committed (same rule as `dedicated-server-api.md`). This file follows `coffee-stain-mod-terms-2026-09-27.md` (issue #471); it does not replace it.

## Findings

- **Still no Coffee Stain EULA or modding policy for Satisfactory at any URL a script can reach** (2026-10-20). Coffee Stain's own legal archive (E1) lists EULAs and privacy policies for Goat Simulator titles and Teardown on console, and none for Satisfactory. Nothing here states what Coffee Stain permits or forbids for mods, for distributing them, or for mods that send data off the server. Recorded as "not found", not guessed.
- **Steam's EULA page for the game still returns only an error** (E2), and the Steam store page for app 526870 links no EULA (no "EULA" or "license agreement" text in the page, 2026-10-20).
- **The local install ships no EULA, licence or terms file** in the game folder's top three levels (searched for `*eula*`, `*licen*`, `*terms*`).
- **What Coffee Stain's own shipped documentation does say about mods** (E3 to E5): the dedicated server protocol has a "Modded" server flag, reserves custom fields "for mods or custom servers", and its HealthCheck carries data "between Modded Dedicated Server and Modded Game Client". This shows the game is built to accommodate modded servers. It is not a licence term and grants nothing.

## Not found (recorded, not guessed)

| URL | Result, 2026-10-20 |
|---|---|
| https://www.satisfactorygame.com/eula | HTTP 404 |
| https://www.satisfactorygame.com/fan-content-policy | HTTP 404 |
| https://www.coffeestain.com/eula | HTTP 404 |
| https://coffeestain.com/eula/ | HTTP 404 |
| https://coffeestain.com/satisfactory-eula/ | HTTP 404 |
| https://coffeestain.com/terms-of-use/ | HTTP 404 |
| https://coffeestain.com/legal/ | HTTP 404 |
| https://coffeestain.com/fan-content-policy/ | HTTP 404 |
| https://www.coffeestainstudios.com/eula | HTTP 404 |
| https://store.steampowered.com/eula/526870_eula_0 | HTTP 200, error text only (E2) |
| https://www.epicgames.com/store/en-US/eula | HTTP 403 for scripted access |
| https://satisfactory.wiki.gg/wiki/Modding | HTTP 403 for scripted access (a community wiki, not a Coffee Stain document) |

What would settle it: the owner reads the EULA the game shows at install or in the Steam/Epic launcher and saves it here dated, or Coffee Stain answers a written question (the same route as ADR-0038's map-image permission request).

### E1 — Coffee Stain's legal archive: every entry (no Satisfactory EULA)

Source: https://coffeestain.com/wp-sitemap-posts-legal_archive-1.xml (linked from https://coffeestain.com/sitemap.xml)

```
https://coffeestain.com/legal/eula-goat-simulator/
https://coffeestain.com/legal/eula-goat-simulator-pocket-edition/
https://coffeestain.com/legal/eula-goat-simulator-mobile/
https://coffeestain.com/legal/eula-goat-simulator-payday-mobile/
https://coffeestain.com/legal/eula-goat-simulator-waste-of-space-mobile/
https://coffeestain.com/legal/eula-goat-simulator-mmo-simulator-mobile/
https://coffeestain.com/legal/eula-goat-simulator-goatz-mobile/
https://coffeestain.com/legal/goat-simulator-privacy-policy/
https://coffeestain.com/legal/teardown-console-privacy-policy/
https://coffeestain.com/legal/teardown-console-eula/
```

### E2 — Steam EULA page for app 526870 (the page's only text)

Source: https://store.steampowered.com/eula/526870_eula_0

```
There was an error loading the content of this EULA.
```

### E3 — Shipped API docs: the "Modded" server flag

Source: `CommunityResources/DedicatedServerAPIDocs.md`, section "Server Flags Bits"

```
| 0              | Modded     | The server is considered Modded. Vanilla clients will not try to connect to Modded servers |
```

### E4 — Shipped API docs: sub-state fields reserved for mods

Source: `CommunityResources/DedicatedServerAPIDocs.md`, section "Server Sub States"

```
| 4            | Custom1              | A value that can be used by the mods or custom servers. Not used by the vanilla clients or servers                      |
```

### E5 — Shipped API docs: HealthCheck and modded saves

Source: `CommunityResources/DedicatedServerAPIDocs.md`, sections "HealthCheck" and the session/save header fields

```
Performs a health check on the Dedicated Server API. Allows passing additional data between Modded Dedicated Server and Modded Game Client.
```

```
| IsModdedSave                | boolean             | True if this save game file was saved with mods                                                            |
```

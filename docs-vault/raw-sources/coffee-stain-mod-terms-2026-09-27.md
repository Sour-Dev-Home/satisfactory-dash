Source: the Coffee Stain / Satisfactory URLs listed below, and https://github.com/satisfactorymodding/Documentation
Captured: 2026-09-27T05:39:34Z
Method: curl of each URL (HTTP status recorded), HTML to text where a page loaded; the community docs' root page from the docs tarball.
Excerpts only: Only quoted excerpts are committed. The source is third-party documentation without a licence that permits redistributing it (the SML Documentation repository has no licence; Epic's API pages are Epic's), so the full text stays verifiable at the pinned URL and a complete local copy is kept outside this repository (the owner's Documents folder, dash-captures/mod-g0-full/, not committed).
Item: 9 of 9: Coffee Stain's terms on mods (EULA clauses, or an official modding statement).
FINDINGS:
  - NO Coffee Stain EULA text and NO official modding statement was found at any URL reachable by a script; nothing here states what Coffee Stain permits or forbids for mods. Recorded as 'not found', not guessed. The ADR-0039 open item on Coffee Stain's terms therefore stays open (the owner may read the EULA shown at install or in the launcher, and ask Coffee Stain, as ADR-0038's map-image permission request does).
NOT FOUND (recorded, not guessed):
  - https://www.satisfactorygame.com/eula: HTTP 404 on 2026-09-27.
  - https://www.satisfactorygame.com/terms: HTTP 404.
  - https://www.satisfactorygame.com/faq: HTTP 404.
  - https://www.satisfactorygame.com/modding: HTTP 404.
  - https://www.coffeestainstudios.com/legal: HTTP 200, but the page is the studio's landing page (no legal text, no EULA).
  - https://coffeestain.com/legal and https://coffeestain.com/eula: HTTP 404. The game page https://coffeestain.com/game/satisfactory/ links only a privacy notice (https://coffeestain.com/privacy-notice/), no EULA and no terms.
  - https://store.steampowered.com/eula/526870_eula_0 (Steam's EULA page for the game): HTTP 200 but the page text is only the error message quoted below.
  - https://satisfactory.wiki.gg/index.php?title=Modding&action=raw (the community 'Official Satisfactory Wiki' Modding page): HTTP 403 'Blocked - wiki.gg' for scripted access; not retried with a browser identity. It is a wiki, not a Coffee Stain document, so it would not settle the question anyway.
  - The Satisfactory press page https://www.satisfactorygame.com/press loads (HTTP 200) and offers a press kit; it states no terms for mods or for asset use (see ADR-0038, same finding).
Convention: each excerpt sits between a BEGIN line and an END line written by the capture (they are not part of the source); the text between them is the source, unedited, with "[... skipped ...]" lines between separate ranges.
---

##### BEGIN Steam EULA page text for app 526870 (all the text the page returns) #####
# Source: https://store.steampowered.com/eula/526870_eula_0
526870_eula_0
There was an error loading the content of this EULA.
##### END Steam EULA page text for app 526870 (all the text the page returns) #####

##### BEGIN index.adoc, lines 8-10, 103-106 #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/index.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/index.html)
# Note: Nearest heading(s): == Basics | === Satisfactory Mod Loader [.title-ref]#(aka. SML)#. An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source.
https://www.satisfactorygame.com/[Satisfactory],
the factory-building sim by https://www.coffeestainstudios.com/games/[Coffee Stain Studios] (CSS).
There are already https://ficsit.app/[over 1200 mods] released
[... skipped ...]
It also provides many helper features to assist in mod development.
Due to how CSS has configured Satisfactory,
it is possible to make mods that do not require SML to function,
however xref:Development/Satisfactory/ModsWithoutSML.adoc[this is rarely done in practice].
##### END index.adoc, lines 8-10, 103-106 #####

Source: the ficsit.app (Satisfactory Mod Repository, SMR) Content Policy as published from its source, https://github.com/satisfactorymodding/smr-frontend/blob/3429ced98a84f40ad44f2be43b0965696dcb003c/src/routes/content-policy/+page.svelte (rendered at https://ficsit.app/content-policy), and the SML docs' upload guide, https://github.com/satisfactorymodding/Documentation/blob/847c361c33015c4fe298274c93418e77543a75de/modules/ROOT/pages/UploadToSMR.adoc (rendered at https://docs.ficsit.app/satisfactory-modding/latest/UploadToSMR.html)
Captured: 2026-10-20
Method: raw.githubusercontent.com at the pinned commits (ficsit.app itself is a script-rendered page whose HTML holds no policy text). smr-frontend is GPL-3.0 (GitHub licence API); the Documentation repository has no licence, so both are kept as excerpts only.
Why it is here: these are the rules of the platform the mod will ship through (owner, 2026-10-20). They are the modding community's rules, **not Coffee Stain's terms**; the SML docs say the community is not affiliated with Coffee Stain (`coffee-stain-mod-terms-2026-09-27.md`, index.adoc excerpt). Issue #471.

## Findings

- ficsit.app requires every mod to state, in its "Network Activity Transparency" section, any external network connection the mod makes; only multiplayer and game-to-game synchronization are exempt (E1). A mod that sends snapshots to our backend falls under this.
- ficsit.app requires an "AI Usage Transparency" section that states what AI tools were used for, including source code directly created by generative AI (E2).
- Mods cannot lock features behind payment (E3).
- The SML docs remind modders that the game's assets are Coffee Stain's copyright and are not redistributed without permission (E6).
- Publishing source is "strongly encouraged", not required, by the upload guide (E4); a C++ mod passes an automated approval against SMR's "terms and conditions" before download (E5). The terms and conditions themselves were not found as a page: NOT FOUND (https://ficsit.app/terms and https://ficsit.app/tos return the same script shell as every ficsit.app path).

### E1 — Content Policy: Network Activity Transparency

```
Mods are required to clearly and explicitly state, in the mod's "Network Activity Transparency" section on
Ficsit.app, any external network connectivity that will occur when using the mod. Multiplayer interaction and
game-to-game synchronization are the only exceptions.
```

```
<li>API integrations with 3rd party services such as Patreon</li>
<li>Communications with remote servers for which the player did not expressly opt-in</li>
```

### E2 — Content Policy: Generative AI Transparency (source code item)

```
Mods are required to clearly and explicitly state, in the mod's "AI Usage Transparency" section on Ficsit.app, the
purposes for which any AI tools have been used in the creation of the mod or its content. This includes both the
mod's in-game content and the content displayed on Ficsit.app.
```

```
<li>If portions of the mod's source code were directly created by generative AI models</li>
```

### E3 — Content Policy: Paid Content

```
Mods cannot lock features behind any form of payment, donation, or subscription. Mods can have early access
versions of itself behind payment, donation, or subscription as long as the intent is to release the early access
version to the public within a reasonable timeframe.
```

### E4 — Upload guide: source link

```
You can also provide a link to your source code, if it is hosted on a site like GitHub or similar.
We strongly encourage you to release your source code,
as it allows others to learn from your work
and helps other developers debug mod compatibility.
```

### E5 — Upload guide: approval of C++ mods

```
If you've uploaded a C++ mod, you'll have to wait for it to be approved by the automated approval process before users can download it.
The approval process is generally quite quick, about 1 to 3 minutes,
and exists to make sure that users aren't uploading content that violates SMR's terms and conditions or harms players' computers.
```

### E6 — SML docs: the game's assets are Coffee Stain's copyright

Source: https://github.com/satisfactorymodding/Documentation/blob/847c361c33015c4fe298274c93418e77543a75de/modules/ROOT/pages/Development/ExtractGameFiles.adoc (rendered at https://docs.ficsit.app/satisfactory-modding/latest/Development/ExtractGameFiles.html). The modding community's statement, not Coffee Stain's.

```
As a reminder, redistributing these assets should not be done without permission,
as they are copyrighted content of Coffee Stain Studios.
```

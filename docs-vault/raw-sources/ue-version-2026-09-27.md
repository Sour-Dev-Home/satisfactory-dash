Source: https://github.com/satisfactorymodding/Documentation at commit d35cc911d6849cb39740cb884735ec5d9ffb2f67 (AsciiDoc source of https://docs.ficsit.app/satisfactory-modding/latest/); https://github.com/satisfactorymodding/SatisfactoryModLoader at commit d2162c999bbaa9650594ee9ad6e6e06190306009
Captured: 2026-09-27T05:39:34Z
Method: the docs tarball for the includes and one excerpt; raw.githubusercontent.com for two small SML project files (both under SML's GPL-3.0, quoted only in part).
Excerpts only: Only quoted excerpts are committed. The source is third-party documentation without a licence that permits redistributing it (the SML Documentation repository has no licence; Epic's API pages are Epic's), so the full text stays verifiable at the pinned URL and a complete local copy is kept outside this repository (the owner's Documents folder, dash-captures/mod-g0-full/, not committed).
Item: 4 of 9: the Unreal Engine version the current game build ships with, and where that is stated.
FINDINGS:
  - ANSWER: Unreal Engine 5.6.1 with Coffee Stain Studios' custom changes. Stated in the docs' software-versions include (`:engine-version: 5.6.1`), in dependencies.adoc ('Satisfactory uses Unreal Engine {engine-version} with custom changes provided by Coffee Stain Studios'), and in SML's FactoryGame.uproject (`EngineAssociation: 5.6.1-CSS`).
  - SML on that same commit is version 3.12.0 (`SML.uplugin`), which is also the SML version last recorded on the owner's server (2026-09-22, game 1.2.4.0, CL 502094).
NOT FOUND (recorded, not guessed):
  - The engine version of the OWNER'S installed dedicated server build: no source here states it, and FRM getSessionInfo carries no engine or game version. [NEEDS VERIFICATION: the engine version line in the dedicated server's own startup log.]
Convention: each excerpt sits between a BEGIN line and an END line written by the capture (they are not part of the source); the text between them is the source, unedited, with "[... skipped ...]" lines between separate ranges.
---

##### BEGIN Development/_includes/software-versions.adoc (whole file, 12 lines) #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/_includes/software-versions.adoc
// UE version (make sure ./BeginnersGuide/_includes/repo-versions.adoc is also accurate)
:engine-version: 5.6.1

// Clang cross-compile toolchain version
:clang-cc-toolchain-version: v25 clang-18.1.0-based

// Wwise versions
:wwise-version-major: 2023.1
:wwise-version-major-minor: 2023.1.14
:wwise-version-full: 2023.1.14.8770
// This one is used by the Wwise api, so by our CI and the Linux setup directions
:wwise-version-stupid-api-suffix: 3555
##### END Development/_includes/software-versions.adoc (whole file, 12 lines) #####

##### BEGIN Development/BeginnersGuide/dependencies.adoc, lines 163-164 #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/BeginnersGuide/dependencies.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/dependencies.html)
# Note: Nearest heading(s): == Clang Toolchain for Linux Dedicated Server Support. An excerpt: the ranges are joined by "[... skipped ...]" lines that are not part of the source.
Currently, Satisfactory uses Unreal Engine {engine-version} with custom changes provided by Coffee Stain Studios.
Therefore, the Cross-Compile Toolchain version required is `{clang-cc-toolchain-version}`.
##### END Development/BeginnersGuide/dependencies.adoc, lines 163-164 #####

##### BEGIN FactoryGame.uproject, lines 1-4 #####
# Source: https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/d2162c999bbaa9650594ee9ad6e6e06190306009/FactoryGame.uproject
{
	"FileVersion": 3,
	"EngineAssociation": "5.6.1-CSS",
	"Category": "",
##### END FactoryGame.uproject, lines 1-4 #####

##### BEGIN Mods/SML/SML.uplugin, lines 1-9 #####
# Source: https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/d2162c999bbaa9650594ee9ad6e6e06190306009/Mods/SML/SML.uplugin
{
	"FileVersion": 3,
	"Version": 3,
	"VersionName": "3.12.0",
	"SemVersion": "3.12.0",
	"GameVersion": ">=491125",
	"FriendlyName": "Satisfactory Mod Loader",
	"Description": "Mod loading and compatibility API for Satisfactory",
	"Category": "Modding",
##### END Mods/SML/SML.uplugin, lines 1-9 #####

Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/BeginnersGuide/ReleaseMod.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/ReleaseMod.html); https://github.com/satisfactorymodding/SatisfactoryModLoader/tree/8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49 (the master branch on the capture date; files named per excerpt)
Captured: 2026-10-19T19:59:13Z
Method: both repositories as tarballs through the GitHub API (`gh api repos/<owner>/<repo>/tarball/<commit>`), Documentation at the same commit as the 2026-09-27 G0 captures and SatisfactoryModLoader at its master commit that day; the docs source searched for Alpakit, RunUAT, command line and automation, and the SML source for `PackagePlugin`, `RunUAT` and `BuildCookRun`; passages copied unedited.
Excerpts only: Only quoted excerpts are committed. The Documentation repository has no licence; SatisfactoryModLoader is GPL-3.0 (`sml-license-2026-09-27.txt`), which would allow a copy, but only the lines this repository cites are kept. The full text stays verifiable at the pinned URLs.
Item: ADR-0039 G0 addendum (#452): how to build a mod for the Windows Server target without the editor UI (the G2 harness's `buildCommand`).
FINDINGS:
  - The docs (Documentation d35cc911) describe packaging only through the editor: the Alpakit Dev window, the Alpakit Release window and its `Alpakit!` buttons (E1, E2; `sml-getting-started-2026-09-27.adoc`, project_setup.adoc "Setting up Alpakit"). They say Alpakit uses the Unreal Build Tool and the Unreal Automation Tool behind the scenes (E2). A command-line invocation: **NOT FOUND in the docs**.
  - The SML source has one: Alpakit is a UAT command named `PackagePlugin` (a `BuildCookRun` subclass, E3), and the editor plugin builds its UAT command line as a format string (E4). The exact invocation SML's own CI runs, on Linux, to package SML itself is E5: `RunUAT.sh ... PackagePlugin ... -server ... -serverplatform=Win64+Linux ...`, after a `Build.sh FactoryEditor Linux Development` step.
  - What is NOT stated by any captured source: the Windows-host form (E5 uses `RunUAT.sh` and Linux `Build.sh` on a Linux runner), and an invocation for a mod other than SML (E5 passes `-dlcname=SML`). A command for the owner's mod on Windows would have to be composed from E4 and E5; it is not composed here.
---

### E1 — Release targets: Windows Server is one of three (ReleaseMod.adoc, lines 396-417)

Source: Documentation d35cc911, `modules/ROOT/pages/Development/BeginnersGuide/ReleaseMod.adoc`.

```adoc
=== Release Targets Explained

As you may be aware, there are multiple different versions of Satisfactory you can download.

The distinction between the Stable (the main branch)
and Experimental (EXP, early feature testing) branch
is relatively well known.
However, there are also are also different builds of the game for different platforms (targets).
There are Stable and EXP variants of each of these:

- `Windows` - Client version of Satisfactory, the one you launch to play the game.
  People playing the game on Linux still use this version, they run it through a compatibility/emulation layer.
- `Windows Server` - Windows Dedicated Server version of Satisfactory.
  It doesn't have a visual interface and is used to run servers from Windows, which is somewhat uncommon.
- `Linux Server` - Linux Dedicated Server version of Satisfactory.
  This is what most dedicated servers will be running, especially those hosted by third party services.

There are also slightly different versions of the Windows client for Steam and Epic.
Your mod must be compiled in a slightly different way to be usable on each of these platforms,
especially to be compatible with Linux Server.

Thankfully, Alpakit handles compiling your mod for all 3 of these target platforms and 2 launcher variants for you!
```

### E2 — Alpakit runs UBT and UAT behind the scenes; output goes to ArchivedPlugins (ReleaseMod.adoc, lines 443-458)

Source: Documentation d35cc911, `modules/ROOT/pages/Development/BeginnersGuide/ReleaseMod.adoc`.

```adoc
to stage your mods files in game's folders for testing.

Behind the scenes, Alpakit uses the Unreal Build Tool and Unreal Automation Tool to generate zip files in the mod's **ArchivedPlugins** folder located at
`<starter project folder>/Saved/ArchivedPlugins/YourModReference/YourModReference-TargetPlatformName.zip`.
Note that this folder is in the **starter project's Saved folder**,
not the Saved folder of any of your mods.

=== Alpakit Release

The 'Alpakit Selected (Release)' and release 'Alpakit!' (just this mod) buttons
compile and package mods for all their enabled targets, combining the output into one multi-target zip file.
In the example image below, clicking `Alpakit!` for ExampleMod builds it for all 3 targets.

image:BeginnersGuide/AlpakitReleaseDemo.png[Alpakit Release with Example Mod and SML selected]

Click the 'Alpakit!' (just this mod) button for your mod and wait for the process to complete.
```

### E3 — The UAT command is `PackagePlugin` (Mods/Alpakit/Source/Alpakit.Automation/PackagePlugin.cs, lines 13-17)

Source: SatisfactoryModLoader 8eebc9e6, https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49/Mods/Alpakit/Source/Alpakit.Automation/PackagePlugin.cs#L13-L17

```csharp
public class PackagePlugin : BuildCookRun
{
	public override void ExecuteBuild()
	{
		var mergeArchive = ParseParam("merge");
```

### E4 — The command line the editor plugin builds (Mods/Alpakit/Source/Alpakit/Private/AlpakitProfile.cpp, lines 47-59 and 68-89)

Source: SatisfactoryModLoader 8eebc9e6, https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49/Mods/Alpakit/Source/Alpakit/Private/AlpakitProfile.cpp#L47-L89 . `AlpakitInstance.cpp` line 31 hands the result to the editor's UAT process: `UATProcess = MakeShareable(new FSerializedUATProcess(Profile->MakeUATCommandLine()));`

```cpp
	if (ServerPlatforms.Len() > 0)
	{
		ServerCommand = TEXT(" -server -serverplatform=") + ServerPlatforms.RightChop(1);
		if (Platforms.Len() == 0)
		{
			OptionalParams += TEXT(" -noclient");
		}
	}
	if (Platforms.Len() > 0)
	{
		PlatformCommand = TEXT(" -platform=") + Platforms.RightChop(1);
		OptionalParams = OptionalParams.Replace(TEXT("-noclient"), TEXT(""));
	}
[... skipped ...]
FString FAlpakitProfile::MakeUATCommandLine() {
	const FString ProjectPath = FPaths::IsProjectFilePathSet()
		? FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath())
		: FPaths::RootDir() / FApp::GetProjectName() / FApp::GetProjectName() + TEXT(".uproject");
	
	FString CommandLine = FString::Printf(TEXT("-ScriptsForProject=\"%s\" PackagePlugin -project=\"%s\" -clientconfig=%s -serverconfig=%s -utf8output -DLCName=%s"),
			*ProjectPath,
			*ProjectPath,
			LexToString(BuildConfiguration),
			LexToString(BuildConfiguration),
			*PluginName);

	if (bBuild) {
		CommandLine += TEXT(" -build");
	}

	CommandLine += MakeUATPlatformArgs();

	CommandLine += GIsEditor || FApp::IsEngineInstalled() ? TEXT(" -nocompileeditor") : TEXT("");
	CommandLine += FApp::IsEngineInstalled() ? TEXT(" -installed") : TEXT("");

	CommandLine += bMergeArchive ? TEXT(" -merge") : TEXT("");
```

### E5 — The exact invocation SML's CI runs to package SML (.github/workflows/build.yml, lines 184-192)

Source: SatisfactoryModLoader 8eebc9e6, https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49/.github/workflows/build.yml#L184-L192 . The job runs on `runs-on: arc-k8s` (line 10) with the custom engine downloaded as `UnrealEngine-CSS-Editor-Linux.tar.zst.*` (line 166) and built with `Engine/Build/BatchFiles/Linux/Build.sh` (line 185): a Linux host.

```yaml
      - name: Build for Development Editor
        run: /tmp/work/ue/Engine/Build/BatchFiles/Linux/Build.sh FactoryEditor Linux Development -project="/tmp/work/SML/FactoryGame.uproject"

      - name: Package SML Mod
        run: |
          # Default is infinity (2^30), and zen (when called during paking) will try to set the current limit to that,
          # which fails because infinity is larger than fs.nr_open. We set this to a sane value instead
          ulimit -n 1048576
          /tmp/work/ue/Engine/Build/BatchFiles/RunUAT.sh -ScriptsForProject="/tmp/work/SML/FactoryGame.uproject" PackagePlugin -Project="/tmp/work/SML/FactoryGame.uproject" -dlcname=SML -merge -build -server -clientconfig=Shipping -serverconfig=Shipping -platform=Win64 -serverplatform=Win64+Linux -nocompileeditor -installed
```

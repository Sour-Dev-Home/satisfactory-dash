Source: https://github.com/satisfactorymodding/Documentation at commit d35cc911d6849cb39740cb884735ec5d9ffb2f67 (the AsciiDoc source of https://docs.ficsit.app/satisfactory-modding/latest/); https://github.com/satisfactorymodding/SatisfactoryModLoader at commit d2162c999bbaa9650594ee9ad6e6e06190306009
Captured: 2026-09-27T05:29:45Z
Method: the same tarball as the other SML docs captures for the excerpt and the two version includes; raw.githubusercontent.com for the two SML project files (FactoryGame.uproject, Mods/SML/SML.uplugin), copied unedited.
Item 4: the Unreal Engine version the current game build ships with, and where that is stated. Answer from these sources: Unreal Engine 5.6.1 with Coffee Stain's custom changes (the docs' software-versions include and dependencies page; the SML project's EngineAssociation 5.6.1-CSS). The SML docs' full dependencies page is in sml-getting-started-2026-09-27.adoc.
Convention: each captured item sits between a BEGIN line and an END line written by the capture (they are not part of the source); everything between them is the source text, unedited (a final newline is added when the source file has none), with one exception: a line holding an example file path that this repository's PII scan rejects is replaced by an '[OMITTED by the capture ...]' marker (only the FAQ in sml-dedicated-servers-2026-09-27.adoc has such lines).
NOT FOUND (recorded, not guessed):
  - The UE version of the OWNER'S installed dedicated server build: none of these sources states it. FRM getSessionInfo carries no engine or game version. [NEEDS VERIFICATION: the engine version line in the dedicated server's own log at startup; the last recorded game build is 1.2.4.0, CL 502094, 2026-09-22, and SML 3.12.0 matches the SML project file below.]
---

##### BEGIN Development/_includes/software-versions.adoc #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/_includes/software-versions.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/_includes/software-versions.html)
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
##### END Development/_includes/software-versions.adoc #####

##### BEGIN Development/BeginnersGuide/_includes/repo-versions.adoc #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/BeginnersGuide/_includes/repo-versions.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/_includes/repo-versions.html)
// :suggested-branch: master
:suggested-branch: dev

// If this is an archived docs branch, this should be set to the SML version it corresponds to.
:this-archive-version: NOT-AN-ARCHIVE
// :this-archive-version: 3.9.1

// Modding UE-CSS release to download (used in URL)
//(make sure ./../_includes/software-versions.adoc is also accurate)
// If this is an archived docs branch, this should be set to the Unreal Engine this SML version needs
:engine-gh-release: latest
// :engine-gh-release: tag/5.6.1-css-83
##### END Development/BeginnersGuide/_includes/repo-versions.adoc #####

##### BEGIN Development/BeginnersGuide/dependencies.adoc (lines 163-165 only, an excerpt) #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/BeginnersGuide/dependencies.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/dependencies.html)
# Note: An excerpt: the whole page is in sml-getting-started-2026-09-27.adoc.
Currently, Satisfactory uses Unreal Engine {engine-version} with custom changes provided by Coffee Stain Studios.
Therefore, the Cross-Compile Toolchain version required is `{clang-cc-toolchain-version}`.
##### END Development/BeginnersGuide/dependencies.adoc (lines 163-165 only, an excerpt) #####

##### BEGIN FactoryGame.uproject #####
# Source: https://github.com/satisfactorymodding/SatisfactoryModLoader/blob/d2162c999bbaa9650594ee9ad6e6e06190306009/FactoryGame.uproject
{
	"FileVersion": 3,
	"EngineAssociation": "5.6.1-CSS",
	"Category": "",
	"Description": "",
	"Modules": [
		{
			"Name": "FactoryGame",
			"Type": "Runtime",
			"LoadingPhase": "Default",
			"AdditionalDependencies": [
				"Engine",
				"CoreUObject",
				"AIModule",
				"GameplayTasks",
				"ReplicationGraph",
				"CinematicCamera",
				"OnlineSubsystemUtils",
				"UMG",
				"DeveloperSettings",
				"AbstractInstance",
				"EnhancedInput",
				"Foliage",
				"GameFeatures"
			]
		},
		{
			"Name": "FactoryEditor",
			"Type": "EditorNoCommandlet",
			"LoadingPhase": "PostEngineInit",
			"AdditionalDependencies": [
				"Engine",
				"CoreUObject",
				"UnrealEd",
				"FactoryGame",
				"EditorSubsystem",
				"Blutility",
				"BlueprintGraph"
			]
		},
		{
			"Name": "FactoryPreEarlyLoadingScreen",
			"Type": "Runtime",
			"LoadingPhase": "PreEarlyLoadingScreen"
		},
		{
			"Name": "FactoryDedicatedServer",
			"Type": "Runtime",
			"LoadingPhase": "Default",
			"TargetAllowList": [
				"Server",
				"Editor"
			]
		},
		{
			"Name": "FactoryDedicatedClient",
			"Type": "Runtime",
			"LoadingPhase": "Default",
			"TargetAllowList": [
				"Editor",
				"Client",
				"Game"
			]
		},
		{
			"Name": "DummyHeaders",
			"Type": "Runtime",
			"LoadingPhase": "Default"
		}
	],
	"Plugins": [
		{
			"Name": "ChaosVehiclesPlugin",
			"Enabled": true
		},
		{
			"Name": "ReplicationGraph",
			"Enabled": true
		},
		{
			"Name": "DTLSHandlerComponent",
			"Enabled": true
		},
		{
			"Name": "Wwise",
			"Enabled": true
		},
		{
			"Name": "ApexDestruction",
			"Enabled": true
		},
		{
			"Name": "BlueprintStats",
			"Enabled": true
		},
		{
			"Name": "ArchVisCharacter",
			"Enabled": false
		},
		{
			"Name": "AndroidMedia",
			"Enabled": false
		},
		{
			"Name": "AvfMedia",
			"Enabled": false
		},
		{
			"Name": "HTML5Networking",
			"Enabled": false
		},
		{
			"Name": "MobileLauncherProfileWizard",
			"Enabled": false
		},
		{
			"Name": "OnlineSubsystemGooglePlay",
			"Enabled": false
		},
		{
			"Name": "OnlineSubsystemIOS",
			"Enabled": false
		},
		{
			"Name": "SubversionSourceControl",
			"Enabled": false
		},
		{
			"Name": "GearVR",
			"Enabled": false
		},
		{
			"Name": "OculusInput",
			"Enabled": false
		},
		{
			"Name": "OculusLibrary",
			"Enabled": false
		},
		{
			"Name": "OculusRift",
			"Enabled": false
		},
		{
			"Name": "SteamVR",
			"Enabled": false
		},
		{
			"Name": "AppleMoviePlayer",
			"Enabled": false
		},
		{
			"Name": "AndroidMoviePlayer",
			"Enabled": false
		},
		{
			"Name": "MobilePatchingUtils",
			"Enabled": false
		},
		{
			"Name": "SlateRemote",
			"Enabled": false
		},
		{
			"Name": "LocationServicesBPLibrary",
			"Enabled": false
		},
		{
			"Name": "AndroidPermission",
			"Enabled": false
		},
		{
			"Name": "MetaHumanCharacter",
			"Enabled": false
		},
		{
			"Name": "LensDistortion",
			"Enabled": true
		},
		{
			"Name": "AndroidDeviceProfileSelector",
			"Enabled": false
		},
		{
			"Name": "Dataflow",
			"Enabled": false
		},
		{
			"Name": "IOSDeviceProfileSelector",
			"Enabled": false
		},
		{
			"Name": "AudioCapture",
			"Enabled": false
		},
		{
			"Name": "WindowsDeviceProfileSelector",
			"Enabled": true
		},
		{
			"Name": "SteamController",
			"Enabled": true,
			"TargetDenyList": [
				"Server",
				"Editor"
			]
		},
		{
			"Name": "MfMedia",
			"Enabled": true
		},
		{
			"Name": "Takes",
			"Enabled": true,
			"TargetAllowList": [
				"Editor",
				"Program"
			]
		},
		{
			"Name": "OnlineSubsystemMcp",
			"Enabled": false
		},
		{
			"Name": "SocketSubsystemEpic",
			"Enabled": false,
			"PlatformAllowList": [
				"Win64"
			],
			"SupportedTargetPlatforms": [
				"Win64",
				"Win32",
				"Mac",
				"Linux"
			]
		},
		{
			"Name": "OnlineServicesNull",
			"Enabled": true
		},
		{
			"Name": "OnlineServicesOSSAdapter",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			],
			"PlatformDenyList": [
				"Linux"
			]
		},
		{
			"Name": "OnlineSubsystemSteam",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			],
			"PlatformAllowList": [
				"Win64",
				"Linux"
			]
		},
		{
			"Name": "OnlineSubsystemEOS",
			"Enabled": false
		},
		{
			"Name": "OculusVR",
			"Enabled": false
		},
		{
			"Name": "PythonScriptPlugin",
			"Enabled": true
		},
		{
			"Name": "EditorScriptingUtilities",
			"Enabled": true
		},
		{
			"Name": "EditorTests",
			"Enabled": true
		},
		{
			"Name": "FbxAutomationTestBuilder",
			"Enabled": true
		},
		{
			"Name": "FunctionalTestingEditor",
			"Enabled": true
		},
		{
			"Name": "RuntimeTests",
			"Enabled": true
		},
		{
			"Name": "MagicLeap",
			"Enabled": false
		},
		{
			"Name": "BlueprintMaterialTextureNodes",
			"Enabled": true
		},
		{
			"Name": "Landmass",
			"Enabled": true
		},
		{
			"Name": "ControlRig",
			"Enabled": true
		},
		{
			"Name": "FullBodyIK",
			"Enabled": true
		},
		{
			"Name": "EnhancedInput",
			"Enabled": true
		},
		{
			"Name": "GameplayCameras",
			"Enabled": true
		},
		{
			"Name": "TemplateSequence",
			"Enabled": true
		},
		{
			"Name": "AbstractInstance",
			"Enabled": true
		},
		{
			"Name": "GeometryScripting",
			"Enabled": true
		},
		{
			"Name": "GeometryCollectionPlugin",
			"Enabled": true
		},
		{
			"Name": "MovieRenderPipeline",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			]
		},
		{
			"Name": "AppleProResMedia",
			"Enabled": true,
			"SupportedTargetPlatforms": [
				"Win64"
			]
		},
		{
			"Name": "ControlFlows",
			"Enabled": true
		},
		{
			"Name": "ModelViewViewModel",
			"Enabled": true
		},
		{
			"Name": "HairStrands",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			]
		},
		{
			"Name": "ChaosCloth",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			]
		},
		{
			"Name": "ChaosVD",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			]
		},
		{
			"Name": "CameraShakePreviewer",
			"Enabled": true,
			"TargetDenyList": [
				"Server"
			]
		},
		{
			"Name": "NNEDenoiser",
			"Enabled": false
		},
		{
			"Name": "GameplayEvents",
			"Enabled": true
		},
		{
			"Name": "WwiseNiagara",
			"Enabled": true
		},
		{
			"Name": "AnimationWarping",
			"Enabled": true
		},
		{
			"Name": "Gauntlet",
			"Enabled": true
		},
		{
			"Name": "TestFramework",
			"Enabled": true
		},
		{
			"Name": "ReliableMessaging",
			"Enabled": true
		},
		{
			"Name": "WinDualShock",
			"Enabled": true,
			"SupportedTargetPlatforms": [
				"Win64"
			]
		},
		{
			"Name": "AnimationLocomotionLibrary",
			"Enabled": true
		},
		{
			"Name": "GameFeatures",
			"Enabled": true
		},
		{
			"Name": "ScriptableToolsEditorMode",
			"Enabled": true
		},
		{
			"Name": "CascadeToNiagaraConverter",
			"Enabled": true
		},
		{
			"Name": "PlanarCut",
			"Enabled": true
		},
		{
			"Name": "ModularGameplay",
			"Enabled": true
		},
		{
			"Name": "OnlineServices",
			"Enabled": true
		},
		{
			"Name": "SlateIM",
			"Enabled": true
		}
	],
	"TargetPlatforms": [
		"Win64",
		"Linux",
		"Windows"
	]
}
##### END FactoryGame.uproject #####

##### BEGIN Mods/SML/SML.uplugin #####
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
	"CreatedBy": "SML Team",
	"CreatedByURL": "https://github.com/satisfactorymodding/SatisfactoryModLoader",
	"DocsURL": "https://docs.ficsit.app",
	"MarketplaceURL": "",
	"SupportURL": "https://discord.ficsit.app",
	"CanContainContent": true,
	"IsBetaVersion": false,
	"IsExperimentalVersion": false,
	"Installed": false,
	"Modules": [
		{
			"Name": "SML",
			"Type": "Runtime",
			"LoadingPhase": "PostDefault"
		}
	],
	"LocalizationTargets": [
		{
			"Name": "SML",
			"LoadingPolicy": "Always",
			"ConfigGenerationPolicy": "Never"
		}
	],
	"Plugins": [
		{
			"Name": "EnhancedInput",
			"Enabled": true,
			"BasePlugin": true
		}
	]
}
##### END Mods/SML/SML.uplugin #####

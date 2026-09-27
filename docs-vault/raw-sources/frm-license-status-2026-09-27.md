Source: https://github.com/porisius/FicsitRemoteMonitoring at commit 32fe64e0c22389a944c27222ef6c881f5e207072 (main), and GitHub's REST API
Captured: 2026-09-27T05:29:45Z
Method: gh api for repository metadata, the license endpoint and code search; raw.githubusercontent.com for README.md, CONTRIBUTING.md and the .uplugin. Repository tree read at the top level only. No FRM source code was read or copied.
Item 8: FRM's licence status. FINDING: no licence file and no licence statement was found. GitHub's repository metadata reports license 'none' and GET /repos/porisius/FicsitRemoteMonitoring/license returns 404; the top level of the repository has no LICENSE or COPYING file. The README's only permission text is the 'Permissions Granted' section quoted below (it covers building your own web UI or serial apps, i.e. clients of FRM's API). CONTRIBUTING.md speaks of 'the project license' but names none. Code under no licence is, by default, all rights reserved, so this project does NOT read or reuse FRM's source (including its use of FHttpModule) for reference. GitHub code search finds one file mentioning FHttpModule (path only, below); its contents were not read. To clear that, the FRM maintainer would have to state a licence. README's 'Special Thanks' section (third-party Discord links) is left out of the capture below on purpose (marked).
Convention: each captured item sits between a BEGIN line and an END line written by the capture (they are not part of the source); everything between them is the source text, unedited (a final newline is added when the source file has none), with one exception: a line holding an example file path that this repository's PII scan rejects is replaced by an '[OMITTED by the capture ...]' marker (only the FAQ in sml-dedicated-servers-2026-09-27.adoc has such lines).
NOT FOUND (recorded, not guessed):
  - A LICENSE, COPYING or NOTICE file in porisius/FicsitRemoteMonitoring: not found (top-level listing below).
  - Any licence statement in README.md, CONTRIBUTING.md or FicsitRemoteMonitoring.uplugin: not found.
---

##### BEGIN GitHub API: repository metadata (fields queried: full_name, license, default_branch, pushed_at) #####
# Source: gh api repos/porisius/FicsitRemoteMonitoring --jq ...
porisius/FicsitRemoteMonitoring license=none default=main pushed=2026-09-17T03:58:19Z
##### END GitHub API: repository metadata (fields queried: full_name, license, default_branch, pushed_at) #####

##### BEGIN GitHub API: GET /repos/porisius/FicsitRemoteMonitoring/license #####
# Source: gh api repos/porisius/FicsitRemoteMonitoring/license
{"message":"Not Found","documentation_url":"https://docs.github.com/rest/licenses/licenses#get-the-license-for-a-repository","status":"404"}
##### END GitHub API: GET /repos/porisius/FicsitRemoteMonitoring/license #####

##### BEGIN Top-level entries of the repository (main) #####
# Source: gh api repos/porisius/FicsitRemoteMonitoring/contents
.github .gitignore CONTRIBUTING.md Config Content Debug Examples FicsitRemoteMonitoring.uplugin Icons JSON Patches README.md Resources Source docs images www
##### END Top-level entries of the repository (main) #####

##### BEGIN README.md, section 'Permissions Granted' (lines 37-38) #####
# Source: https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/README.md
# Note: An excerpt; the rest of the README (badges, install notes, the third-party 'Special Thanks' links) is not captured.
## Permissions Granted
Feel free to create your own web UI or serial apps.
##### END README.md, section 'Permissions Granted' (lines 37-38) #####

##### BEGIN CONTRIBUTING.md, 'Legal Notice' (lines 43-44) #####
# Source: https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/CONTRIBUTING.md
# Note: An excerpt.
> ### Legal Notice <!-- omit in toc -->
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project license.
##### END CONTRIBUTING.md, 'Legal Notice' (lines 43-44) #####

##### BEGIN FicsitRemoteMonitoring.uplugin (whole file) #####
# Source: https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/FicsitRemoteMonitoring.uplugin
{
	"FileVersion": 3,
	"Version": 1,
	"VersionName": "1.5.3",
	"SemVersion": "1.5.3",
	"AcceptsAnyRemoteVersion": true,
	"FriendlyName": "Ficsit Remote Monitoring",
	"Description": "Statistical and GeoLocation Monitoring for Satisfactory",
	"Category": "Modding",
	"CreatedBy": "Porisius",
	"CreatedByURL": "",
	"DocsURL": "https://docs.ficsit.app/ficsitremotemonitoring/latest/index.html",
	"MarketplaceURL": "",
	"SupportURL": "https://github.com/porisius/FicsitRemoteMonitoring",
	"CanContainContent": true,
	"IsBetaVersion": false,
	"IsExperimentalVersion": false,
	"Installed": false,
	"Modules": [
		{
			"Name": "FicsitRemoteMonitoring",
			"Type": "Runtime",
			"LoadingPhase": "Default"
		},
		{
			"Name": "FicsitRemoteMonitoringServer",
			"Type": "Runtime",
			"LoadingPhase": "Default",
			"TargetAllowList": [
				"Editor",
				"Server"
			]
		}
	],
	"Plugins": [
		{
			"Name": "SML",
			"SemVersion": "^3.12.0",
			"Enabled": true
		}
	],
	"GameVersion": ">=491125",
	"RequiredOnRemote": false,
	"BuiltInInitialFeatureState": "Active"
}
##### END FicsitRemoteMonitoring.uplugin (whole file) #####

##### BEGIN GitHub code search: FHttpModule in porisius/FicsitRemoteMonitoring (result paths only) #####
# Source: gh api search/code?q=FHttpModule+repo:porisius/FicsitRemoteMonitoring
1 result: Source/FicsitRemoteMonitoring/Private/Libraries/Notifications.cpp (file not read)
##### END GitHub code search: FHttpModule in porisius/FicsitRemoteMonitoring (result paths only) #####

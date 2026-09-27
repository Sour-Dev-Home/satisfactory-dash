Source: the Coffee Stain / Satisfactory URLs listed below, and https://github.com/satisfactorymodding/Documentation
Captured: 2026-09-27T05:29:45Z
Method: curl of each URL (HTTP status recorded), HTML to text where a page loaded; the community docs' root page from the same tarball as the other SML captures.
Item 9: Coffee Stain's terms on mods (EULA clauses, or an official modding statement). FINDING: NO Coffee Stain EULA text and NO official modding statement was found at any URL reachable by a script; nothing here states what Coffee Stain permits or forbids for mods. This is recorded as 'not found', not guessed. The ADR-0039 [NEEDS VERIFICATION] on Coffee Stain's terms therefore stays open (the owner may read the EULA shown at install or in the launcher, and ask Coffee Stain, as ADR-0038's map-image permission request does).
Convention: each captured item sits between a BEGIN line and an END line written by the capture (they are not part of the source); everything between them is the source text, unedited (a final newline is added when the source file has none), with one exception: a line holding an example file path that this repository's PII scan rejects is replaced by an '[OMITTED by the capture ...]' marker (only the FAQ in sml-dedicated-servers-2026-09-27.adoc has such lines).
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
---

##### BEGIN Steam EULA page text for app 526870 (all the text the page returns) #####
# Source: https://store.steampowered.com/eula/526870_eula_0
526870_eula_0
There was an error loading the content of this EULA.
##### END Steam EULA page text for app 526870 (all the text the page returns) #####

##### BEGIN index.adoc #####
# Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/index.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/index.html)
# Note: The community docs' root page: it names Coffee Stain Studios (CSS) and describes SML, but it states no Coffee Stain terms.
= Satisfactory Modding Documentation

== Basics

Welcome to the Satisfactory Modding Documentation site! 

Here you can find lots of information regarding modding
https://www.satisfactorygame.com/[Satisfactory],
the factory-building sim by https://www.coffeestainstudios.com/games/[Coffee Stain Studios] (CSS).
There are already https://ficsit.app/[over 1200 mods] released
and we maintain in-depth documentation on how you can create your own.

In this page, we will provide some surface level information for both mod users and developers.

[TIP]
====
We suggest you join our https://discord.ficsit.app[Discord Server]
to get support and chat with fellow mod users and developers!
====

== For Users

If you'd like to get started using mods, this section is for you.

=== Welcome Guide

If this is your first time modding Satisfactory,
check out the xref:ForUsers/Welcome.adoc[Welcome to the Community] guide to get started with mods quickly.

====
xref:ForUsers/Welcome.adoc[View the "Welcome to the Community" guide ➡]
====

=== Satisfactory Mod Repository

The Satisfactory Mod Repository (SMR) is the most extensive collection of mods made for Satisfactory.
It's easy to upload a mod of your own or write a guide for other users.
Uploaded content is tested for malware and such before it is approved for download.
Visit https://ficsit.app/[ficsit.app] to see it for yourself!

=== Satisfactory Mod Manager

The Satisfactory Mod Manager (SMM) makes it simple to install mods, their dependencies, and the mod loader.
It connects to https://ficsit.app/[SMR], allowing for quick and easy installation of all mods.

====
xref:ForUsers/SatisfactoryModManager.adoc[Learn how to install and use the mod manager on the "Using the Mod Manager" page  ➡]
====

We highly recommend using Satisfactory Mod Manager as it makes using mods that much easier.
However, if you _really_ don't want to use it,
directions for manual installation can be found xref:ManualInstallDirections.adoc[here].

== For Developers

If you'd like to write a mod of your own, this section is for you.

Satisfactory mods can be written in Unreal Blueprint or {cpp}.
Community created libraries also allow writing mods
with JSON files xref:Development/BeginnersGuide/overwriting.adoc#_contentlib[(ContentLib)].
// cspell:ignore tweakit
// or Lua xref:Development/BeginnersGuide/overwriting.adoc#_tweakit[(TweakIt)].

If you're looking to write your own mods, we suggest you start with
making Blueprint mods first rather than {cpp} mods.
Check out the xref:Development/BeginnersGuide/index.adoc[Getting Started Guide]
and consider picking up the `Aspiring Modder` role in the "Channels & Roles" section of our https://discord.ficsit.app[Discord].

====
xref:Development/BeginnersGuide/index.adoc[Get started developing Unreal Blueprint and {cpp} mods ➡]
====

====
link:https://docs.ficsit.app/contentlib/latest/index.html[Get started developing mods with JSON text files and ContentLib ➡]
====

If you're looking to make 3D models for the game, it's best to learn how to put a mod together first.
Once you've completed the "Buildable" page in the Getting Started guide, check out our xref:Development/Modeling/index.adoc[Modeling Guide].

=== Uploading Your Mod to SMR

After you've finished your mod (or at least its first version), you might want to upload it to https://ficsit.app/[SMR]. To do that, follow the steps xref:UploadToSMR.adoc[here]!

== Archived Forums

The community used to have a Discourse-powered forums website for modding discussion,
but it has since been archived due to low usage.
You can find the archives https://web.archive.org/web/20260309124622/https://forums.ficsit.app/index-2.html[here].

== Contributing

You can find information on how to contribute to the docs
https://github.com/satisfactorymodding/Documentation#contributing[in the GitHub repo's readme].

== Modding Technologies

If you'd like to learn more about how modding works internally, this is the section for you.

=== Satisfactory Mod Loader [.title-ref]#(aka. SML)#

Satisfactory Mod Loader (SML) provides a framework that makes it easier for mods to be able 
to load into systems provided by the game, and to interact with each other.
It also provides many helper features to assist in mod development.
Due to how CSS has configured Satisfactory,
it is possible to make mods that do not require SML to function,
however xref:Development/Satisfactory/ModsWithoutSML.adoc[this is rarely done in practice].

=== Alpakit

Alpakit is an Unreal Engine Plugin created by Mircea and other contributors
allowing you to easily cook and package your mod for deployment and distribution.
It is also able to directly install it into your game installation for you.
Behind the scenes, it uses Unreal Pak and some custom code to accomplish this.
##### END index.adoc #####

---
title: Setting up a server from scratch
description: From no server to a running dedicated server with the Satis Manager mod paired and every player able to join: hosting, mods, pairing and players.
order: 2
updated: 2026-11-09
---
This guide takes you all the way: getting a dedicated server, installing the mod loader and the Satis Manager mod on it, pairing it with your dashboard, and getting your players in. If you already run a server with mods, skip to [Connecting a server](/guides/connecting-a-server).

## What you'll end up with

- A Satisfactory **dedicated server** running your save.
- The **Satisfactory Mod Loader (SML)** and the **Satis Manager mod** on that server.
- The server **paired** with your Satis Manager account, so the dashboard shows it live.
- **SML on every player's game.** A server with mods only lets in players who have the mod loader too. Players don't need the Satis Manager mod itself: it runs on the server only.

## Step 1: get a dedicated server

Pick one:

- **A rented server.** Choose a host that supports mods: one that gives you SFTP access usually does. Some FTP-only panels can't run mods at all. Your host installs the dedicated server for you.
- **Your own Windows PC.** Install **Satisfactory Dedicated Server** from Steam (it's listed under Tools) or the Epic Games Store, or with SteamCMD (app 1690800).
- **Your own Linux machine.** Install the dedicated server with SteamCMD (app 1690800), or run it in a container such as Docker.

If friends will join from outside your network, let the server through your firewall and forward its ports on your router. Since game version 1.1 that is two ports: the game port, 7777 by default, on both TCP and UDP, and the reliable messaging port, 8888 by default, on TCP. Forward the game port to the same number outside as inside your network: the game can't use a different external number for it.

Start the server once, then claim it from the game: open Satisfactory, add the server in the game's **Server Manager**, claim it as its admin, and start a new game or upload your save. Check that you can join it before adding any mods.

## Step 2: install the mod loader and the Satis Manager mod on the server

The Satis Manager mod needs **SML 3.12.0 or later** (3.x) on the server, and no other mod.

**With Satisfactory Mod Manager (SMM):** add your server in SMM (it often finds a server installed on the same PC through Steam or Epic; otherwise give it the folder, or SFTP for a rented host). SMM installs SML for you along with the mods that need it. The Satis Manager mod isn't in SMM's catalogue yet, so add it by hand (step 3 below) once SML is on the server.

**By hand:**
1. Stop the server.
2. Download SML from [ficsit.app](https://ficsit.app/mod/SML), choosing the build for your server (Windows server or Linux server), and unzip it into `FactoryGame/Mods` in the server's folder, so its files end up in `FactoryGame/Mods/SML/`. Folder names and nesting matter.
3. Install the Satis Manager mod into `FactoryGame/Mods/SatisDashAgent/`. That folder should hold `SatisDashAgent.uplugin` directly, not another folder. Download it from the mod's [releases page on GitHub](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/releases/latest): take `SatisDashAgent-WindowsServer.zip` or `SatisDashAgent-LinuxServer.zip` for your server.
4. Start the server.

## Step 3: pair the server with your dashboard

On its first start, the mod prints a pairing code in the server console and in the server's log, `FactoryGame.log` (usually under `FactoryGame/Saved/Logs` in the server's folder). The line looks like this:

> Pairing code ABCD-EFGH-JKLM: sign in at satis-manager.com/pair and enter it (expires in 15 minutes)

On a Linux server in a container, such as Docker, the console can lag minutes behind the log, so read the code in `FactoryGame.log` there. If you join the server while you're the only player on, the code also shows in the game's chat. The chat can't be copied, so type the code; codes never contain 0, 1, 8 or 9.

You need a Satis Manager account to approve the code. Sign-in is invite-only during the beta (see [Getting started](/guides/getting-started)), so for now pairing works only with an account that already exists.

1. Go to [satis-manager.com/pair](/app/pair) and sign in. Later, you can also get there from **Settings**, under **Satis Manager mod**, with the **Pair a server** link.
2. Type the code and press **Continue**. Lower case and missing dashes are fine.
3. Check that the server details under "Is this your server?" are yours, choose **A new server** (or **One of my servers** to reuse one), and press **Approve**.

The server log then says it has paired with the dashboard. A code lasts 15 minutes and the mod shows a new one for an hour after the server starts; after that, restart the server or join it alone to get another.

## Step 4: see it in the dashboard

Within a minute, the Overview, Power and Factory pages show your server live. The map layers (rails, belts, power lines, markers and the rest) follow about 8 minutes later. If you paired onto a server that already had data, the map shows the old factory until then, for up to about 9 minutes.

## Step 5: get your players in

Every player needs **SML** in their game, or the server turns them away with "cannot connect a modded server to a vanilla client". They don't need the Satis Manager mod.

Each player:
1. Installs **Satisfactory Mod Manager (SMM)** and opens it.
2. Installs **Satisfactory Mod Loader** in their game with SMM, or by hand: download the game build (not a server build) from [ficsit.app](https://ficsit.app/mod/SML) and unzip it into `FactoryGame/Mods` in their game folder. Keeping it at the same version as the server's avoids surprises.
3. Starts the game, adds your server's address and port in the **Server Manager**, and joins.

## If something goes wrong

| What you see | What to do |
|---|---|
| "cannot connect a modded server to a vanilla client" | That player needs SML in their game (step 5) |
| No pairing code in the console | Read `FactoryGame.log`; check the mod's folder holds `SatisDashAgent.uplugin` directly |
| The code expired | Wait for the next one, or restart the server |
| Map still shows an old factory | Wait about 9 minutes after pairing |
| Data stopped after a game update | Update SML and the mod; mods can stop loading until they match the game |

For more, see [Connecting a server](/guides/connecting-a-server).

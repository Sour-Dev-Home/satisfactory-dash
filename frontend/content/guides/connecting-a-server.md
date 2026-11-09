---
title: Connecting a server
description: Connect a Satisfactory dedicated server to Satis Manager with its mod: install it, paste the enrolment code, and fix a connection.
order: 3
updated: 2026-11-09
---
Satis Manager never reaches into your network. Instead, the Satis Manager mod runs inside your dedicated server, reads the game directly, and sends the readings out to the dashboard over HTTPS. You don't open or forward any port for it, and you don't give the dashboard your game's admin token. This guide covers installing the mod, linking it to your account, and what to check when a server doesn't show up.

## What the mod is

The mod is a server-side mod for the Satisfactory dedicated server. It loads with the server, like any other mod, so there is no second program to run and nothing to keep open on your PC. Players don't need the Satis Manager mod: only the server has it. They do need the Satisfactory Mod Loader (SML) in their own game, because a server with SML turns away players without it ("cannot connect a modded server to a vanilla client"). [Setting up a server from scratch](/guides/setting-up-from-scratch) shows how players install it.

It reads the game from the inside: the server status, power, machines, trains, belts and the other map layers. It doesn't need any other mod to do that, apart from the Satisfactory Mod Loader (SML) that every mod runs on.

What your server needs:

- **A host that allows mods.** Hosts that give you SFTP usually let you install mods with Satisfactory Mod Manager. Some FTP-only panels don't support mods at all.
- **Outbound HTTPS from the game.** The mod only makes outgoing connections. If your host blocks them, the mod can't reach the dashboard.

## Step 1: install the mod

The mod isn't published yet. When it is, this guide will link to its download.

Install it the way your host supports mods: with Satisfactory Mod Manager connected to your server over SFTP, or by uploading the mod into the server's `FactoryGame/Mods` folder. The Satisfactory Mod Loader loads mods when the server starts, so start or restart the server once after installing.

On its first start without a code, the mod writes its config file, `FactoryGame/Configs/SatisDashAgent.cfg`, with the dashboard's address filled in and an empty code. It then waits; your game runs normally in the meantime.

## Step 2: add the server and get a code

1. In **Settings**, under **Your server**, press **Add your server** and give it a name. (On your very first visit the app asks for this straight away.)
2. In **Settings**, under **Satis Manager mod**, press **Create enrolment code**. This section is where the dashboard shows your mod's connection.
3. Copy the code. It has 12 letters and digits in three groups, like AB3D-7XQ2-K5MN, and it never contains 0, 1, 8 or 9. It works once and lasts 10 minutes.

A server that hasn't connected within 24 hours of adding it is removed automatically. If your code expires, just create another.

## Step 3: paste the code

1. Open `FactoryGame/Configs/SatisDashAgent.cfg` on the game server, with your host's file manager or over SFTP.
2. Paste the code as the value of `enrollmentCode`. Leave `backendUrl` as it is.
3. Save the file.

The mod notices when its config file changes and reads it again, so you don't need to restart the server. Once it has connected, **Settings** shows the server as enrolled, and data arrives within a few seconds. The mod keeps its own credential after that, so later restarts need no code.

## Or pair from the server's console

If editing a file on your host is awkward, mod 0.3.0 and later can show you a pairing code instead. It does this on its own when its config has no code and it has never connected.

The code appears in the server console and in its log, `FactoryGame.log`, as a line like "Pairing code ABCD-EFGH-JKLM: sign in at satis-manager.com/pair and enter it (expires in 15 minutes)". The mod also posts it in the in-game chat when a new code starts while exactly one player is on, or when a player joins an empty server while a code is live.

On a Linux server in a container, such as Docker, the console can lag minutes behind the log, so read the code in `FactoryGame.log` there. The code in the chat can't be copied, so type it: codes never contain 0, 1, 8 or 9, so there's no 0 or 1 to mistake for O or I.

1. Go to [satis-manager.com/pair](/app/pair) and sign in, or use the **Pair a server** link in **Settings**, under **Satis Manager mod**, or the **Pair it** link beside the add-server form.
2. Type the code and press **Continue**. Lower case and missing dashes are fine.
3. Check the server name, version and request time under "Is this your server?", choose **A new server** or **One of my servers**, and press **Approve**.

Only approve a server you started pairing yourself. A code lasts about 15 minutes (the console line says exactly how long), and the mod shows a fresh one when it expires, for an hour after the server starts. After the first hour the server goes quiet; restart it, or join it when nobody else is on, to get a new code. A code in the config file always wins: if you paste one, the mod enrols with it instead.

If you paired onto a server that already had data (**One of my servers**), Power and Factory are live within a minute, but the map can show the old factory for up to about 8 to 9 minutes. The mod sends its first map layers a few minutes after it starts reporting, and until then the dashboard keeps the last ones it had.

If you revoke the mod's access in **Settings**, the mod stops until the server restarts. A restart starts pairing again; joining doesn't.

## How your connection is protected

- **No inbound port.** The mod only makes outgoing connections.
- **No game admin token.** The mod reads the game from the inside, so its config holds only the dashboard's address and the code.
- **Codes are single use** and short-lived, and the service stores only a hash of each one.
- **The mod's credential** is a file in the server's folder. On a rented host, anyone with access to those files, such as the host's staff or other SFTP users, could read it. If you think it leaked, press **Revoke…** in Settings, then **Revoke the mod's access**. The mod then drops the old credential, and you can connect it again with a new code.

## Troubleshooting

Open **Settings** and look at **Satis Manager mod**. The **Mod** row says whether the mod is enrolled, **Online** or **Offline**, and when it was last seen.

| What you see | What it means | What to do |
|---|---|---|
| The code expired | More than 10 minutes passed | Create a new code and paste it again |
| Never shows as enrolled | The mod didn't load, or can't get out | Check the log for the mod's lines; ask your host whether outbound HTTPS is allowed |
| "That code isn't valid" on Pair a server | Wrong, expired or used code | Check it, or restart the server for a new one |
| Shows **Offline** | No reading for a couple of minutes | Is the server running? Did a game update disable mods? |
| Stopped after you revoked it | The old credential was dropped | Create a new code and paste it, or pair again |
| A player can't join: "cannot connect a modded server to a vanilla client" | Their game has no mod loader | They install SML in their game; they don't need the Satis Manager mod |
| The map still shows an old factory after pairing | Map layers arrive a few minutes after the rest | Wait about 9 minutes |

After a game update, a mod can stop loading until a matching version is out. If data stops right after an update, check that the mod and the mod loader are up to date.

---
title: Connecting a server
description: How a Satisfactory dedicated server reaches Satis Manager through the edge agent or the dashboard mod, what each needs, and how to fix a connection.
order: 2
updated: 2026-11-03
---
Satis Manager never reaches into your network. Instead, a small sender runs on the machine that hosts your game, reads the game locally, and sends the readings out to the dashboard over HTTPS. You don't open or forward any port for it. There are two senders; this guide covers both and what to check when a server doesn't show up.

## The two ways to connect

| | Edge agent | Dashboard mod |
|---|---|---|
| What it is | A program that runs beside the game server | A server-side mod that runs inside the game |
| Runs on | Windows or Linux, on the game machine | The game server itself |
| The host must allow | Running your own program | Mods, and outbound HTTPS from the game |
| Players shown | Names of players online | Player counts only |
| Status | The main path today | Early and experimental |

Pick the agent if you run the server on your own PC or on a machine where you have a shell. The mod is meant for rented hosts where you can install mods but can't run a second program.

There's also a third kind of connection you may see in Settings: "Directly, from the dashboard's backend". That is only used for the service operator's own servers. It isn't offered for new servers, because it would mean keeping your game's admin token in the cloud and calling into your network.

## Step 1: add the server and get a code

1. In **Settings**, under **Your server**, press **Add your server** and give it a name. (On your very first visit the app asks for this straight away.)
2. In **Settings**, under **Game PC agent**, press **Create enrolment code**.
3. Copy the code. It has 12 letters and digits in three groups, like AB3D-7XQ2-K5MN, and it never contains 0, 1, 8 or 9. It works once and lasts 10 minutes.

A server that hasn't connected within 24 hours of adding it is removed automatically. If your code expires, just create another.

## Option A: the edge agent

### What it needs

- **Node.js 22 or newer** on the game machine. For now the agent is built from the project's source code; there is no installer yet.
- **The game's API token.** This is an application token. You create one by running `server.GenerateAPIToken` in the dedicated server's console. Application tokens don't expire.
- **The FicsitRemoteMonitoring (FRM) token**, only if you use FRM. FRM is a separate community mod that gives the agent your power circuits, machines, belts and map data. Without FRM, the agent can only send what the game's own API offers, such as whether a save is loaded, the player count, the tick rate and the server options.

If you use FRM, check that its web server is set to start with the game. FRM's config has an Autostart setting for its web server, and its port defaults to 8080.

### Setting it up

Run these in order, on the game machine, as the same user each time:

1. **`node agent.cjs set-tokens`** asks for the game's API token and the FRM token at a hidden prompt (press Enter if you have no FRM token). Tokens are never accepted on the command line, since other programs can read command lines. The agent assumes the game is on this machine at API port 7777 and FRM port 8080; use `--host`, `--api-port` and `--frm-port` only if yours differ. It refuses a public address, so a typo can't send your token across the internet.
2. **`node agent.cjs check`** reads the game once and prints what works, with counts only. Fix any failure before going on. A missing FRM isn't a failure.
3. **Enrol.** Settings shows the exact `node agent.cjs enroll` command with your code and the dashboard's address. Copy it and run it within the 10 minutes. If this PC was enrolled before, add `--replace`.
4. **`node agent.cjs run`** starts it. Watch it in a console once, then set it to start on its own: a Scheduled Task on Windows (run as the same Windows user, "Run only when user is logged on" is simplest), or the provided systemd service on Linux.

The agent sends readings of your game and its own version, nothing about your PC. The [FAQ](/guides/faq) lists exactly what it reads.

## Option B: the dashboard mod

The mod is still early and experimental. It runs inside the game server and sends readings out the same way the agent does. Your host has to allow mods and outbound HTTPS from the game.

You can connect it in either of two ways:

- **With an enrolment code.** Open `FactoryGame/Configs/SatisDashAgent.cfg` on the game server, paste the code as the value of `enrollmentCode`, and start the server. On its first start without a code, the mod writes this file for you with an empty code and waits.
- **By pairing.** The mod shows a pairing code in the server console or log (FactoryGame.log), or in pairing.txt next to the mod. In the dashboard, open **Pair a server** (the **Pair it** link beside the add-server form), type the code and press **Continue**. Check the server name, version and request time under "Is this your server?", choose **A new server** or **One of my servers**, and press **Approve**. Only approve a server you started pairing yourself.

On a rented host, the mod's credential sits in a file in the server's folder, so anyone with access to those files, such as the host's staff or other SFTP users, could read it.

## How your connection is protected

- **No inbound port.** The sender only makes outgoing connections.
- **Your game tokens stay on your machine**, encrypted for your Windows user, or on Linux in a file only the agent's user can read.
- **Codes are single use** and short-lived, and the service stores only a hash of each one.
- **The agent's own credential** is stored encrypted and never shown again. If you think it leaked, press **Revoke…** in Settings, then **Revoke the agent**, and enrol again.

If you connect with the agent, the members of your server can see who is online. Settings has a ready-made message under **Tell your players** that you can copy into your server's Discord.

## Troubleshooting

Open **Settings** and look at **Game PC agent**. The **Agent** row says whether it's enrolled, **Online** or **Offline**, and when it was last seen. The **Game** row says whether the agent can reach your game: **Reachable**, **Not reachable**, or unknown while the agent is offline.

| What you see | What it means | What to do |
|---|---|---|
| The code expired | More than 10 minutes passed | Create a new code |
| "That code isn't valid" on Pair a server | Wrong, expired or used code | Check it, or restart the server for a new one |
| Agent shows **Offline** | No reading for a couple of minutes | Is the PC on, the task running, the log moving? |
| Game shows **Not reachable** | The game isn't running, or the ports are wrong | Start the game, then run `node agent.cjs check` |
| `upstream_auth_rejected` in the log | The API token was refused | Make a new application token, run `set-tokens` again |
| Agent stopped, "rejected this agent's credential" | It was revoked or replaced | Create a new code, then enrol with `--replace` |
| "could not unprotect the agent's store" (Windows) | Wrong user, or the task doesn't load the profile | Run it as the user that set it up, then `node agent.cjs resume` |
| Bottlenecks say "Update FRM to 1.5.4 or newer" | Older FRM, no belt data | Update FRM for belt-level detail |

The agent's daily log, in its data folder, holds codes and counts only, never your tokens or player names, so it's safe to share when asking for help.

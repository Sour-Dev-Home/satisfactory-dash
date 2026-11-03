---
title: Frequently asked questions
description: Answers about privacy, what Satis Manager reads from your server, whether it changes your game, FRM and the dashboard mod, and cost.
order: 9
updated: 2026-11-03
---
Short answers to the questions people ask most. Each one links to the guide with more detail.

## Does Satis Manager change my game?

Only if you ask it to, and only in one way. The single setting it can change is the server's auto-pause, the **Auto-pause when no players are connected** switch in **Settings**. When you flip it, the dashboard sends the change to the program on your game PC, which asks the server to apply it. Until the server confirms, Settings says "Change pending: the server will apply it."

Everything else is read only. Satis Manager doesn't build, move, delete or reset anything in your world, and it never touches your save files. Even removing a server from the dashboard leaves your game alone: "Your game and its saves are never touched: nothing on your game PC changes."

A note on auto-pause itself: pausing doesn't lower your hosting cost, and while the game is paused, live values, alerts and history all stand still.

## What does it read from my server?

Readings of the game world:

- The server status: whether a save is loaded, whether it's paused, the session name, the player count and limit, and the tick rate.
- Power: each circuit's production, consumption, capacity, batteries and fuse.
- Machines: their names, recipes, rates, states and positions.
- World layers for the map: rails, trains and stations, resource nodes, players' map markers, drone ports, power lines, and belts and pipes.
- The auto-pause setting.
- With the edge agent, the names of players who are online.

It reads nothing about your computer: no host name, network address, user name, file path or operating system.

Opening the dashboard doesn't add load on your server either. The program on your game PC reads the game on its own fixed schedule, and the dashboard shows those readings, however many people are watching.

## What about my privacy?

The [privacy policy](/privacy) is the full answer. In short:

- You sign in with Google. Accounts created by signing up keep your Google account id but not your email address.
- You get a generated display name, such as "Player-4F2K". That's what other members of a shared server see.
- Player names from the game are shown live to that server's members only. They're kept in memory and never written to the database or the logs.
- Names players type in the game, like station, train and marker names, are shown only to that server's members.
- The only cookies are the ones needed to keep you signed in and to protect the Google sign-in.

You can leave a server, or delete your account, from **Settings**, under **Your account**.

## Who can see my server?

Only its members. The person who added a server is its owner. Owners and admins can do more, such as creating enrolment codes, revoking the agent and reshaping factories on the Planner. Viewers can look but not change anything.

If you connect with the edge agent, your server's members can see who is online. Settings has a short, ready-made message under **Tell your players** that you can paste into your server's Discord, so your players know.

## Does my game's admin token go to the cloud?

Not with the edge agent. The game's API token, and the FRM token if you have one, stay on your game machine, encrypted. The agent sends readings out; the dashboard never calls into your network, and you don't open any port for it. See [Connecting a server](/guides/connecting-a-server).

## What's FRM, and do I need it?

FicsitRemoteMonitoring (FRM) is a separate community mod for Satisfactory. It runs a small web server inside the game that reports factory data: power circuits, machines, belts, trains and more.

The edge agent reads two sources on the game machine: the game's own dedicated server API, and FRM if it's installed. The game's API alone gives the basics, like whether a save is loaded, the player count, the tick rate and server options such as auto-pause. Power, machines, the Planner and most of the map need FRM.

For belt-level detail in the bottleneck finder, FRM 1.5.4 or newer is needed. With an older FRM, the Factory page says "Item-level results only. Update FRM to 1.5.4 or newer for belt detail."

## What's the dashboard mod, then?

It's Satis Manager's own server-side mod, the second way to connect a server. It runs inside the game and reads the game directly, so it's meant for rented hosts where you can add mods but can't run a separate program. It sends player counts, not names. It's still early and experimental; the edge agent is the main path today.

In short: FRM is a community mod the edge agent reads from. The dashboard mod is a sender in its own right. See [Connecting a server](/guides/connecting-a-server) for how each is set up.

## Can I try it without a server?

Yes. The demo at demo.satis-manager.com runs the whole dashboard on a made-up factory, with no account. Press **Enter demo**. See [Getting started](/guides/getting-started).

## How do I get alerts?

In **Settings**, under **Alert settings**. Alerts can go to a Discord channel through a webhook, or to your devices as push notifications. A power outage alert is set up for every server. You can mute alerts for a while with **Mute until**. The [Power guide](/guides/power) explains when they fire and when they stay quiet.

## Is it free?

Yes, Satis Manager is free to use. Running the service still costs money, so the site may show ads to help cover it. If it does, they go only below a page's content on the Overview, Power, Factory and Planner pages, never on the Map, Settings or sign-in pages. Check the [privacy policy](/privacy) for what applies today.

## Is it made by the game's developers?

No. Satis Manager is an independent project. Satisfactory, its map and its icons belong to Coffee Stain Studios, and Satis Manager isn't affiliated with them. The source code is public on GitHub, linked from the front page.

## Something's wrong. Where do I start?

- The Overview's headline names the problem in a few words. See [Reading the Overview](/guides/overview-and-status).
- If the server doesn't show up or the data is old, open **Settings** and check **Game PC agent**. The troubleshooting table in [Connecting a server](/guides/connecting-a-server) covers the usual causes.
- For slow production, see [Finding and fixing bottlenecks](/guides/bottlenecks).

---
title: Frequently asked questions
description: Answers about privacy, what Satis Manager reads from your server, whether it changes your game, the Satis Manager mod, and cost.
order: 9
updated: 2026-11-03
---
Short answers to the questions people ask most. Each one links to the guide with more detail.

## Does Satis Manager change my game?

Only if you ask it to, and only in one way. The single setting it can change is the server's auto-pause, the **Auto-pause when no players are connected** switch in **Settings**. When you flip it, the dashboard sends the change to the mod on your server, which applies it in the game. Until the server confirms, Settings says "Change pending: the server will apply it."

Everything else is read only. Satis Manager doesn't build, move, delete or reset anything in your world, and it never touches your save files. Even removing a server from the dashboard leaves your game alone: "Your game and its saves are never touched: nothing on your game PC changes."

A note on auto-pause itself: pausing doesn't lower your hosting cost, and while the game is paused, live values, alerts and history all stand still.

## What does it read from my server?

Readings of the game world:

- The server status: whether a save is loaded, whether it's paused, the session name, the player count and limit, and the tick rate.
- Power: each circuit's production, consumption, capacity, batteries and fuse.
- Machines: their names, recipes, rates, states and positions.
- World layers for the map: rails, trains and stations, resource nodes, players' map markers, drone ports, power lines, and belts and pipes.
- The auto-pause setting.
- The names of players who are online.

It reads nothing about the machine the server runs on: no host name, network address, user name, file path or operating system.

Opening the dashboard doesn't add load on your server either. The mod reads the game on its own fixed schedule, and the dashboard shows those readings, however many people are watching.

## What about my privacy?

The [privacy policy](/privacy) is the full answer. In short:

- You sign in with Google. Accounts created by signing up keep your Google account id but not your email address.
- You get a generated display name, such as "Player-4F2K". That's what other members of a shared server see.
- Player names from the game are shown live to that server's members only. They're kept in memory and never written to the database or the logs.
- Names players type in the game, like station, train and marker names, are shown only to that server's members.
- The only cookies are the ones needed to keep you signed in and to protect the Google sign-in.

You can leave a server, or delete your account, from **Settings**, under **Your account**.

## Who can see my server?

Only its members. The person who added a server is its owner. Owners and admins can do more, such as creating enrolment codes, revoking the mod's connection and reshaping factories on the Planner. Viewers can look but not change anything.

Your server's members can see who is online. Settings has a short, ready-made message under **Tell your players** that you can paste into your server's Discord, so your players know.

## Does my game's admin token go to the cloud?

No. The mod runs inside the game and reads it from there, so it never needs the game's admin token, and you never give one to the dashboard. The mod's config holds only the dashboard's address and your enrolment code. The mod sends readings out; the dashboard never calls into your network, and you don't open any port for it. See [Connecting a server](/guides/connecting-a-server).

## What's the Satis Manager mod?

It's how a server connects to Satis Manager: a server-side mod that loads with your dedicated server and reads the game directly. Only the server needs it; players join as usual, with nothing to install. It runs on the Satisfactory Mod Loader, like other mods, and needs no other mod to read your factory.

The mod isn't published yet. [Connecting a server](/guides/connecting-a-server) covers installing it and will link to its download once it's out.

## Do I need to restart the server after pasting the code?

No. The mod reads its config file again when it changes, so saving the file is enough. You restart the server once, after installing the mod, because mods load when the server starts.

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
- If the server doesn't show up or the data is old, open **Settings** and check **Game PC agent**, where the mod's connection is shown. The troubleshooting table in [Connecting a server](/guides/connecting-a-server) covers the usual causes.
- For slow production, see [Finding and fixing bottlenecks](/guides/bottlenecks).

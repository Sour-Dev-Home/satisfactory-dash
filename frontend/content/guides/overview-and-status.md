---
title: Reading the Overview and its status summary
description: What the Overview's status headline means, the exact rules behind Operational, Degraded, Paused and Outage, and when a warning can be hidden.
order: 3
updated: 2026-11-03
---
The Overview is the first page you see after signing in. Its job is to answer one question quickly: is the factory all right? It does that with a status summary in the Health card, a Players card and a Power card. This guide explains what each part says and the rules behind the words, so you know when to worry and when not to.

## The Health card

The Health card has a heart icon, a one-word state and a headline, then a row per section: **Server**, **Power** and **Factory**. Below the state is the server's tick rate. The card's header has a small freshness badge: "live", under a minute, or a number of minutes. It turns amber when the reading is late. Hover over it, or use a screen reader, to get the exact age.

The worst section decides the headline:

| State | Headline | When |
|---|---|---|
| Operational | All systems operational | Every section is fine |
| Paused | Game paused | The game is paused and nothing worse is going on |
| Degraded | Running with warnings | At least one section has a warning |
| Unavailable | Some data is unavailable | A section couldn't be loaded at all |
| Outage | Power outage | A circuit's fuse has tripped |

While the page is still loading you'll see "Checking…". Right after the dashboard itself has been updated, it may say "Back in a moment" for a short while instead of an error.

The dashboard doesn't invent its own alarms here. The game server's readings are classified once, by the service, and the Overview only adds them up. The one exception is the factory rule below.

## The Server row

- **Operational**: it shows the save's session name and the player count, such as "3 / 8 players".
- **Paused: no players connected**: the server has paused the game, usually because of auto-pause. Values are frozen while paused. This isn't a fault, and it's the only place the Overview says the game is paused.
- **No save loaded**: the server is running but no game is loaded. This counts as a warning.
- **Showing last known data**: readings from the game have stopped arriving, so you're looking at the last ones. This is a warning too. If the game is also paused, the row adds "· game paused".

## The tick rate

The tick rate is how many times per second the server updates the world. The service calls it **Healthy** above 10 ticks per second and **Slow** at 10 or below. The game's own API reports this as an average.

A slow tick doesn't get a row of its own. It makes the overall state Degraded, and the headline then names the cause directly, for example "Server tick is slow · Factory backed up", so the page always says why it's warning. A big factory, many players, or a busy host can all slow the tick.

## The Power row

- **Outage**: one or more circuits have a tripped fuse. The row says how many, for example "2 circuits have a tripped fuse".
- **Degraded, "circuits at risk"**: a circuit is drawing more than its capacity, or its batteries are draining and below 20%. The [Power guide](/guides/power) explains these rules.
- **Showing last known power data**: power readings are out of date.
- **Operational**: the number of circuits and the total, for example "4 circuits · 820 MW of 1,200 MW capacity".

## The Factory row and the 25% rule

The Factory row counts machines and how many are backed up: "312 machines · 14 backed up". A backed-up machine has a full output and nowhere to send it. In a working factory that's often normal: a line that makes more than the next step needs will fill its belts and wait. So a few backed-up machines are just a count, shown in amber, not a warning.

The row turns **Degraded** only when **more than 25% of all machines are backed up**. At that point something downstream is usually stuck: a full storage container, a broken belt, or a consumer that stopped. The row then reads, for example, "90 of 300 machines backed up", and the headline says "Factory backed up".

The 25% line is a choice made for this dashboard. It's a rule of thumb, not a game rule. If you see it trip, open the [Factory page](/guides/factory), turn on the **Backed up** filter, and look at the [bottleneck list](/guides/bottlenecks) for the cause.

The row is also Degraded when factory readings are out of date ("Showing last known factory data"). With no machines yet, it says "No machines yet".

## Hiding a warning

When the state is **Degraded** or **Paused**, the Health card offers a button to hide the warning, labelled "Hide this warning until something changes". Use it when you already know about a problem and don't need the reminder.

A hidden warning comes back on its own when something changes: another section starts warning, or a warning gets worse. A count moving inside a warning you already hid, say 14 backed-up machines becoming 15, doesn't bring it back.

An **Outage** or missing data can't be hidden. Those always show.

## The Players and Power cards

The **Players** card shows how many players are on out of the server's limit. It also lists the names of players online. Names are shown live and never stored. If the game is paused it says "The game is paused."

The **Power** card gives a quick look at the grid, with a thin animated line that moves while power is drawn and stays still at 0 MW or when your device asks for reduced motion. For the full picture, open the Power page.

## When a section won't load

If a section can't be loaded at all, its row says "Couldn't load this section" and the overall state becomes Unavailable. If the whole game server is unreachable, one banner says so at the top of the page, instead of every panel repeating it. Check the connection in **Settings**, under **Game PC agent**, and see [Connecting a server](/guides/connecting-a-server) for fixes.

## A quick routine

1. Glance at the headline. "All systems operational" means you can go back to what you were doing.
2. If it's amber, read the section rows. The cause is named in a few words.
3. Follow the row to its page: Power for circuits, Factory for machines.
4. Fixed it, or decided to live with it? Hide the warning, and the card will tell you if anything new happens.

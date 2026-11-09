---
title: Finding and fixing bottlenecks
description: What underfed and backed up mean, how Satis Manager's bottleneck finder traces a slow line to its cause, and common ways to fix it.
order: 7
updated: 2026-11-03
---
A bottleneck is the one place in a production line that holds everything else back. Fix it and the whole line speeds up. Fix anything else and nothing changes. Finding it by walking the factory can take a long time, so Satis Manager does the walking for you. It reads your machines and the belts and pipes between them, and writes a short sentence for each cause it finds.

This guide explains the two kinds of trouble it looks for, how to read its findings, and some fixes that usually help.

## Two kinds of stuck machine

Every finding starts from a machine in one of two states (the [Factory guide](/guides/factory) has the full list of states):

- **Underfed**: the machine is making less than 95% of what it's set for. It's short of at least one ingredient. The finder looks **upstream**: where should that ingredient come from, and why isn't enough arriving?
- **Backed up**: the machine's output is full. Its products have nowhere to go. The finder looks **downstream**: where should the output go, and why isn't it leaving?

A backed-up machine feeding a slower consumer is often healthy: it's just ahead of demand. The finder knows that. When it walks upstream from an underfed machine and meets a backed-up producer, it treats that producer as fine. There's plenty of the item; the problem is getting it across.

## Where to find the findings

- On the **Factory** page, the summary at the top gives the count ("3 bottlenecks", or "All machines are fed and flowing.") and links to the full **Bottlenecks** list further down.
- On the **Planner**, factories and groups carry a bottleneck badge, so you can see which part of the graph is affected.

The list shows the top 10 causes, ranked by how much output each one costs. Machines that share one cause are grouped, so ten findings are ten different problems, not one problem repeated ten times.

## Reading a finding

Each finding has up to five parts. Here is a made-up example:

1. **The machine and its state.** "Constructor, Iron Plate, near (120, −40) · Underfed". The position is in metres in the game world, so you can find it on the [Map](/guides/map).
2. **The sentence.** "Constructor is underfed: at full speed, Iron Ingot is made at most 90 items/min and its consumers want 120 items/min."
3. **The belt that caps it**, when there is one: "Conveyor Belt Mk.1 · 60 items/min · near (−554, −1278)".
4. **Affects N machines.** Open it to see the other machines with the same cause.
5. **A fix**, when the finder can work one out: "Fix: About 2 more Smelter (Iron Ingot), 30 items/min each, at full speed."

If the shortfall is under 2% of what's wanted, the finding adds that it "may be clock rounding". Rates at a set clock speed can differ from the game's by a rounding step, so a tiny gap may not be a real shortage.

## What the causes mean

For an **underfed** machine, the sentence says one of these:

| The finding says | What it means |
|---|---|
| nothing in the factory makes the item | No machine produces it at all. You need a new line, or a delivery. |
| the item is made, but no belt or pipe connects it | A producer exists but isn't hooked up to this machine. |
| at full speed, the item is made at most A and its consumers want B | Not enough producers. Supply is lower than demand even at 100%. |
| the item comes from a machine which is short itself | The real cause is further up. Follow it. |
| a belt or pipe caps the item at its rated rate | Enough is made, but the belt in between is too slow for the flow. |
| enough is made, but it isn't reaching the machine | The data can't say why: splitter balancing, filters, mixed belts or overflow are common reasons. |
| it's fed only from storage, a station or an extractor | The contents of those aren't read, so the finder can't trace further. |
| a supplier is unpowered, paused or idle | The producer stopped. Fix it first. |
| the shortage loops back | The line feeds itself, and the loop is short. |

For a **backed-up** machine, the mirror cases are:

- **Nothing reachable consumes the item.** It may go to storage, a sink or a generator, which the data doesn't show.
- **Its consumers take less than it makes.** That's surplus. Often fine, unless that machine also makes something you need.
- **The item goes to a machine that is held up itself.** Follow it downstream.
- **A belt or pipe caps the item leaving it.** The output belt is too slow for what the machine makes.

## Belt speeds the finder uses

For belts, the finder reads each belt's rated capacity from the game. The rates per tier are: Mk.1 carries 60 items per minute, Mk.2 120, Mk.3 270 and Mk.4 480. Pipes are rated in cubic metres per minute: 300 for Mk.1 and 600 for Mk.2. A finding names the tier and its rate, so you know what to upgrade to.

## When the finder has less to work with

The notes under the list tell you how much the finder could see:

- **"Connections refresh every 10 minutes."** Belts are read less often than machines. A belt you built or rebuilt a few minutes ago may not show yet.
- **"Item-level results only: this factory's connection data is too large to read."** Very big factories skip belt detail.

## Fixes that usually help

This is general advice. Your factory is yours, and the finding tells you where to start.

- **Not enough producers.** Build the number of machines the fix line suggests, or overclock the ones you have if you have power shards. Remember they need their own inputs too.
- **A belt caps the flow.** Upgrade that belt to a faster tier, or run a second belt beside it.
- **Enough is made but it isn't arriving.** Look at the splitters and mergers in between. Uneven splits starve the far end of a manifold, and a mixed belt can block when one item backs up.
- **Nothing consumes the output.** Check where the line ends: a full container, a sink that was removed, a train station whose route changed.
- **A supplier stopped.** Fix that machine first. Its own state on the Factory page tells you why: unpowered, paused or no recipe.
- **A loop is short.** Add a small extra input to the loop, or build a buffer so it can start up.

After a fix, give it a few minutes. Machine readings update about every 30 seconds, and belts every 10 minutes. Then check that the finding is gone and the count went down. If it moved to a different machine, that's progress: you found the first bottleneck, and now you can see the next one.

For the line around a finding, open the [Planner](/guides/planner): it shows the same machines as a graph, with the rates on each link.

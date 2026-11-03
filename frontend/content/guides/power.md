---
title: The Power page
description: What Satis Manager measures on each power circuit, how it decides OK, At risk and Outage, how to read the charts, and how to get power alerts.
order: 4
updated: 2026-11-03
---
The Power page shows every power circuit in your world as its own card, plus charts of how production and consumption moved over time. It's the place to look when the Overview says "Power outage" or "circuits at risk", and also the place to plan ahead before you add a big new line.

## What a circuit is

A circuit is one connected power network: every generator, battery and machine joined by power lines. If you have two separate grids that never touch, you get two circuits. The game numbers them, and the cards use those numbers: "Circuit 1", "Circuit 3". The numbers come from the game, so they can change when you join or split grids.

The cards are sorted worst first. A circuit with a tripped fuse is at the top, then circuits at risk, then the healthy ones. Each card has its own link (for example /app/power#circuit-3), so you can send someone straight to it.

## What each card shows

| Field | What it means |
|---|---|
| **Production** | The power being produced on the circuit right now, in MW. This matches the "Produced" line on the in-game power graph. |
| **Consumption** | The power being drawn right now. |
| **Capacity** | What the circuit's generators can produce at their current settings. |
| **Peak demand** | What the circuit would draw if every machine on it ran flat out. |

If the circuit has batteries, the card adds three more rows:

- **Battery storage**: the total the batteries can hold, in MWh.
- **Battery charge**: how full they are, as a percentage.
- **Battery flow**: "Charging" or "Discharging" with the rate, or "Idle" when nothing moves.

These numbers come from the Satis Manager mod, which reads power from the game itself: each circuit's production, consumption, capacity, maximum consumption, battery state and whether its fuse has tripped.

## OK, At risk and Outage

Each card wears a badge. The rules are simple and fixed. No guessing is involved.

- **Outage: fuse tripped.** The circuit's fuse has blown. This is the one direct outage signal the game gives. While tripped, the circuit reads 0 MW, and the card says so: "Reads 0 MW while the fuse is tripped."
- **At risk.** Either the circuit is drawing more than its capacity right now, or its batteries are draining and below 20% charge. Batteries can cover a short gap, so this is a warning, not an outage yet. The 20% line is this dashboard's choice; it isn't a number from the game.
- **OK.** Neither of the above.

There's also a softer note that isn't a status: **"Could overload: peak demand is above capacity."** It appears when the circuit is fine right now, but would draw more than it can produce if every machine ran at full speed at once. That often happens after you build a new line that isn't fully fed yet. Once its inputs arrive, demand rises, and the fuse may trip. Treat it as a heads-up.

## Reading the charts

Below the cards is the history. A row of range buttons sits at the top: **Live** (the last 5 minutes), then **1 h**, **6 h**, **24 h**, **7 d**, **30 d** and **1 y**.

- **Live** fills in as the server is read, every few seconds. Right after you open the page it may say "No readings yet. The chart fills in as the server is polled."
- The longer ranges come from stored history and show averages over each step of time.

Each circuit gets its own chart with two lines: **Production** and **Consumption**. Beside each figure are its min and max for the range. Each chart also has a table with the same numbers by time, with columns for Production, Consumption, Capacity and Fuse, for screen readers and for anyone who wants exact values.

A few things that help when reading them:

- **Gaps are real.** If the server was off or unreachable for a while, the chart shows a gap rather than drawing a line across it.
- **Paused time is flat.** While the game is paused, values are frozen.
- **Game sessions are split.** If the range covers an earlier game session, for example after loading a different save, the page notes "An earlier game session in this range" so you don't compare two different worlds.
- **Production close to consumption** means you have little headroom. A new machine could tip it over.
- **Consumption with a steady rise** over 7 days is your factory growing. Compare it with Capacity before you plan the next build.

If history is behind, the page says "Power history is behind: showing the last readings the server kept."

## What to do about an outage

Some general advice. Your own factory will have its own reasons.

1. **Find the circuit.** It's the top card. Note its Peak demand and Capacity.
2. **Look at what changed.** The 1 h or 6 h chart usually shows the moment consumption crossed capacity, or production fell.
3. **Production fell?** A generator likely ran out of fuel or water. Check the fuel line feeding it on the [Factory page](/guides/factory) or the [Planner](/guides/planner).
4. **Consumption rose?** You added machines, or a line that was starved started running. Add generators, add batteries to ride out spikes, or split the load onto another circuit.
5. **Restore power in the game** once the cause is fixed. The card goes back to OK on the next reading.

## Power alerts

You don't have to keep the page open. In **Settings**, under **Alert settings**, the service can send alerts to a Discord channel through a webhook, or as push notifications to your devices. A **Power outage** rule is set up for every server, one alert per circuit, and it's marked critical. It fires as soon as a circuit reports a tripped fuse.

Alerts pause themselves when it makes sense:

- **The game is paused**: power and machine rules aren't checked, because the values are frozen.
- **The server is unreachable**: only the "Game server unreachable" alert speaks, so you don't get a flood.
- **You muted alerts**: use **Mute until** to silence a server for a while, for example during a big rebuild.

For the rest of the dashboard's health summary, see [Reading the Overview](/guides/overview-and-status).

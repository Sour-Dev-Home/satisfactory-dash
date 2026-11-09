---
title: The Factory page
description: How to read machine states such as producing, underfed and backed up, use the grouped machine table and its filters, and follow production over time.
order: 6
updated: 2026-11-03
---
The Factory page lists every production machine on your server: what it's making, how fast, and whether it's running well. It opens with a short bottleneck summary, then a "Since yesterday" panel, then the full machine table, production history and the complete bottleneck list. A bar near the top, **Factory sections**, jumps between **Machines**, **History** and **Bottlenecks**, and stays at the top of the screen while you scroll the table.

## Machine states

Every machine gets one state, decided by the service from the game's own readings. The rules are fixed and checked in this order, so the first one that fits wins:

| State | What it means |
|---|---|
| **Paused** | A player paused the machine in the game. |
| **Unpowered** | It isn't connected to any power circuit, or its circuit's fuse has tripped. |
| **Idle** | It has no recipe set. |
| **Backed up** | Its output is full and has nowhere to go. A machine with every input full but low output counts too, since it's held up by its output, not short of input. |
| **Underfed** | It's making less than 95% of what it's set for. It's getting fewer ingredients than it needs. |
| **Producing** | Powered, set up, and running at 95% or more of its rate. |

A few details worth knowing:

- **"What it's set for" includes the clock speed.** A machine you underclocked to 50% and fed fully counts as producing, not underfed. The table shows the clock next to the recipe when it isn't 100%, for example "Clock 160%".
- **It isn't judged from a flicker.** The state isn't decided from the game's momentary "is it producing right now" flag, but from the machine's reported efficiency percentage, so a brief gap on a belt doesn't usually flip it to underfed.
- **No state is better than a wrong one.** If the readings needed to decide are missing, the row shows no state rather than a guess.

## Backed up isn't always bad

A backed-up machine sounds like trouble, but in a steady factory it's often fine. If a line makes 60 plates a minute and the next step uses 45, the plate machines will fill their outputs and wait. That's a full buffer, not a failure.

That's why backed-up machines are shown as a count and a filter, in amber, never as a red alarm. The Overview only warns when more than a quarter of all machines are backed up at once (see [Reading the Overview](/guides/overview-and-status)). Underfed machines are usually the more useful thing to look at: they mean a shortage somewhere upstream.

## The summary line and filters

Above the table is a summary such as "312 machines · 14 backed up · 3 paused · 2 without a recipe". Under it are filter buttons with counts: **All**, **Backed up**, **Paused** and **No recipe**.

- Press **All** to show everything.
- Press any other filter to show only those machines. Turn on several and you see machines that match any of them, so each extra filter widens the list.
- **Search machines** narrows the table to machines whose name or recipe contains what you type. The search is kept in the address too, as `?q=`.

The filters live in the page's address, as `?state=` followed by a comma list. For example, /app/factory?state=backedUp,paused shows backed-up and paused machines. The values are `backedUp`, `paused` and `noRecipe`. Bookmark it, or send it to a friend on the same server, and the page opens already filtered.

## The grouped machine table

The table is grouped the same way the [Planner](/guides/planner) groups your factory. Each factory is a section you can fold, with a heading like "Iron Plate factory · 11 machines · 1 backed up". Inside it, machines with the same building and recipe form a group, such as "4× Constructor, Iron Plate". Machines that don't belong to a factory are under **Other machines**. If the Planner's factories can't be read, the page says so and lists every machine in one table.

The columns are **Machine**, **Recipe**, **Inputs**, **Outputs** and **State**. Inputs and outputs show each item and its rate per minute. Belt items are in items per minute, and fluids in cubic metres per minute.

Each state word wears a small mark in its colour, the same mark the Planner uses, so you can spot a backed-up or underfed row at a glance. The word always stays, so you never have to tell states apart by colour alone.

On a big factory the table shows the first 50 machines, then "Showing 50 of N machines." and a **Show all N machines** button. That keeps the page quick on a phone.

## Since yesterday

This panel compares the latest complete hour with the same hour yesterday, item by item, and lists the biggest changes under **Down** and **Up**, at most three each. To count, a change has to be at least 10% of yesterday's rate and at least 1 per minute, so a trickle moving from 0.2 to 0.1 isn't news.

If nothing moved much, it says "No big changes since this hour yesterday." On a new server it says "Not enough history yet" until a day of readings exists.

## Production history

**Production history** charts how much of an item your factory made over time. Pick a range, **1 h**, **6 h**, **24 h**, **7 d**, **30 d** or **1 y**, and an item. You get the item's average, low and high for that range, and a table by time with the amount produced next to the capacity, which is what your machines could make at full speed.

A gap between produced and capacity is the clearest sign that a line is starved or blocked. A gap that opened at a certain time points you to what changed then.

## The bottleneck summary

At the top of the page, a compact summary counts the current bottlenecks: "3 bottlenecks", "10+ bottlenecks" when there are more than the list shows, or "All machines are fed and flowing." It links down to the full **Bottlenecks** list, where each cause is explained in a sentence, with the machines it affects and, where it can, a suggested fix. [Finding and fixing bottlenecks](/guides/bottlenecks) covers that list in detail.

## When the data is old

If the game server can't be reached, the page keeps the last reading and says "Showing last known factory data from" followed by the time, and dims the table. While the game is paused, every machine's numbers are frozen too. The age of the reading is always at the bottom of the panel.

## A routine for a growing factory

1. Open the page and read the bottleneck summary first.
2. Turn on **Backed up** and see whether the backed-up machines cluster in one factory section. A cluster usually means one full container or one stopped consumer.
3. Check **Since yesterday** for a sudden drop. A drop with a time attached is the easiest kind to trace.
4. Use the full bottleneck list for the cause, then the [Planner](/guides/planner) to see the line it sits on.

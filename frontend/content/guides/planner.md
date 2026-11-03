---
title: Reading the Planner
description: How to read the Planner's graph and outline: factories, groups, links, measured and estimated rates, line widths, moving lines, caps and stalled marks.
order: 7
updated: 2026-11-03
---
The Planner draws your production as a map of flows. Each box is a factory or a group of machines, and each line is an item moving from one to the next. Where the Factory page answers "what is each machine doing?", the Planner answers "where does this item come from, and where does it go?"

## Graph and outline

The Planner has two views, chosen with the **Graph** and **Outline** buttons. On a wide screen it opens on the graph. On a phone it opens on the outline, a text form of the same data that's easier to read on a small screen and works fully with a keyboard or screen reader.

## Factories and groups

The service groups your machines into **factories** automatically, mostly by what each line finally makes: an iron plate line, a motor line, and so on. Machines joined by a train or a drone can belong to the same factory even when they're far apart.

- The first level, **All factories**, shows one card per factory and the flows between them.
- Open a factory card to see its **groups**. A group is a set of identical machines making one recipe, such as "4× Constructor, Iron Plate".
- A group with more than one machine can open further, into a card per machine (up to 48, then a "+k more" card). The lines still join the whole group's frame, because the game reports belts per group, not per machine.

Factories can be **nested**, up to three levels: a "Main base" holding an "Iron works" holding an "Iron Plate factory". When anything nests, a breadcrumb, **Factory path**, shows where you are, and the back button reads "All factories" or "Back to" the parent's name. The page address keeps the path (as `?open=`), so the browser's back button works and you can bookmark a factory.

## Reading a line

Every line is a flow of items. The small icons on its label show what it carries, up to three items, then a "+k" chip for more. A line whose item can't be worked out shows a "?" bubble. Under the icons is the rate.

The rate comes in three kinds, and the line style tells you which:

| Legend | Line | Rate words | What it means |
|---|---|---|---|
| **measured** | solid | "120 items/min" | One source feeds this group, so the rate is the group's measured use of the item. |
| **about (estimated)** | dashed | "about 120 items/min" | Several sources share the item. The use is split in proportion to what each one makes. |
| **unknown** | dotted, fainter | no number | The data can't tell. |

Why estimates at all? The game doesn't report what's on a belt or how fast it moves, so rates are worked out from what the machines at each end make and use. Splitters, filters and mixed belts make the exact split unknowable, so the Planner says "about" or leaves the number out. The page's **About this data** note says the same.

Other line styles in the legend: a **mixed belt** (several items) has a thin inner stroke; a **pipe** carries fluids in m³/min; a **transport** (train, truck, drone or depot) is a double line with a small vehicle icon. A card's product can also read "0 of 160": its machines could make 160 a minute but are making none.

## Width and speed words

Line width shows the rate in three steps, and the words match:

| Step | Belts (items/min) | Pipes (m³/min) | Width |
|---|---|---|---|
| slow | under 120 | under 300 | thinnest |
| medium | 120 to under 480 | 300 to under 600 | middle |
| fast | 480 or more | 600 or more | widest |

The belt steps sit at a full Mk.2 belt (120) and a full Mk.4 belt (480); the pipe steps at a full Mk.1 (300) and Mk.2 (600). The legend's own words: "The speed is the rate, not the belt." A fast belt tier carrying 30 items a minute is still slow. The step word is added to the rate wherever it's written, such as "about 120 items/min, medium", so you never need to judge widths by eye.

## Moving lines

Lines that carry something move from source to destination at their step's speed. An estimated line's dashes march. A measured line stays solid with a faint pulse running along it. Unknown and stalled lines stay still.

Only lines in view move, up to a limit, and nothing moves while you pan or zoom. The **Motion** control picks **System** (follow your device's reduced-motion setting), **On** or **Off**.

## Caps: where flows end

Some flows end somewhere with no card to draw a line to: a storage container, a sink, power generators, a station. Those show as small **caps** in a row along the bottom of the card, one per kind of end, with an icon and a count. Each cap has its own rate and speed step, like a line.

## Stalled marks

A card is **stalled** when its product reads 0 and all its machines are backed up, underfed, paused or idle. With **State marks** on (the default), a stalled card shows the state's mark instead of a word, and its outgoing lines end in a stop bar in the state's colour instead of an arrowhead. Turn **State marks** off to see words instead. Either way, the full sentence is in the tooltip, for example "The source is backed up".

A card with a clock icon and "Conveyor data older than the factory read" is built from belt data that hasn't caught up with a rebuild yet. It refreshes within 10 minutes.

## The toolbar

- **Item**: pick one item (or **All items**) to light up only the lines that carry it. Use it to follow one product through the base.
- **Zoom in**, **Zoom out** and **Fit to view**. With the graph focused, plus and minus zoom, the arrow keys pan and 0 fits.
- **Expand all** and **Collapse all** open or fold everything at the current level. On the overview, a factory card can also expand in place to show its parts; a card that's too big says "Too large to expand here; open it".
- **Storage detail** shows or folds storage and buffers into chips.
- **State marks** and **Motion**, described above.

Click a card to open its panel with its machines, outputs and actions.

## The outline

The outline starts with a summary, then **Needs attention**: stalled outputs, bottlenecks and unknown ends, each with **Show in graph**. Below that is the tree of factories and groups. Each group is a sentence, with its neighbours as buttons that jump to their rows. **All connections** is a sortable table of every link with From, To, Item and Rate.

## Shaping your factories

If you're an owner or admin of the server, you can change how factories are drawn. This only changes the dashboard's view. Nothing in your game moves.

- On the overview, pick factories with **Select** (or Shift- or Ctrl-click a card), then **Merge into one**, **Group into a new factory** or **Move to…**. A parent has **Ungroup**.
- Inside a factory, select groups to **Split** them into a new factory or **Designate** them as one. A group's panel has **Pop out**.
- A factory you made can be renamed, or **Dissolved** so its machines go back to automatic factories.

Every change shows a short message with **Undo** for a few seconds. A button that can't be used says why.

For finding what holds a line back, see [Finding and fixing bottlenecks](/guides/bottlenecks).

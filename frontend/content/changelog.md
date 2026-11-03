---
title: Changelog
description: Notable changes to Satis Manager you can see in the dashboard, newest first.
updated: 2026-11-03
---
The changes you can see in the dashboard, newest first. Fixes behind the scenes and work that isn't visible yet are left out.

## 3 November 2026

- New: [guides](/guides/getting-started) to every page of the dashboard, and this changelog.

## 1 November 2026

- **Factory**: the machine table is grouped by the Planner's factories, as sections you can fold, with a count of machines and backed-up machines in each heading.
- **Factory**: each machine's state wears the same small mark the Planner uses. The state filters are now toggles: turn on several at once, and the choice is kept in the page's link.
- **Planner**: nested factories are on for everyone. Factories can hold other factories, up to three levels, with a path at the top to step back up. Owners and admins can group factories into a new parent, move them, ungroup them, and expand a factory in place to see its parts.
- **Planner**: a new outline view replaces the old tables. It starts with what needs attention, each item with a button to show it in the graph.
- **Planner**: the legend explains the three rate steps, slow, medium and fast, and what each line width means.

## 28 October 2026

- **Factory**: big factories show the first 50 machines with a button to show the rest. A bar with Machines, History and Bottlenecks stays at the top while you scroll.
- **Planner**: line width now shows the rate, and lines that carry something move at a speed that matches it. Trains, trucks, drones and depots draw as double lines.
- **Planner**: flows that end at storage, a sink, power or a station show as small caps on the card, with their own rate.

## 27 October 2026

- **Factory**: the page opens with a short summary of the current bottlenecks.
- **Map**: new layers for players' map markers, drone ports and their routes, power lines, and belts and pipes. Power lines and belts start switched off.
- **Planner**: links show what they carry as item icons instead of words.
- **Planner**: owners and admins can merge factories and split them, with an undo after each change.
- **Planner**: a stalled card and its lines show the state's mark and a stop bar. The **State marks** button switches back to words.
- **Planner**: a product that reads 0 now says what it could make, such as "0 of 160", and the page explains why an item or rate can be unknown.
- **Planner**: the "Reason factories for me" suggestion mode was removed.
- **Settings**: your server's connection status shows whether the game could be read, and when it was last read.

## 26 October 2026

- **Map**: the island's terrain is drawn under the grid, traced from the game's map.
- **Planner**: cards are compact and show the building's icon. Owners and admins can select groups, including with a freehand lasso, and name them as a factory.

## 25 October 2026

- **Pair a server**: a new page to approve a server by typing the pairing code it shows.
- **Map**: a live trains layer, updated every 10 seconds, with train stations.

## 24 October 2026

- **Planner**: the new Planner page, with a graph of the flows between your machines and the game's own building icons.
- **Power**: a circuit's Production now matches the "Produced" line on the in-game power graph.
- **Settings**: a change to auto-pause that the server hasn't applied yet shows as pending.

## 23 October 2026

- **Overview**: the Health card shows how fresh its reading is as a small badge, which turns amber when it's late.

## 22 October 2026

- **Factory**: bottlenecks are grouped by cause, so the top 10 are ten different problems. Each shows how many machines it affects and, for a shortage, roughly how many more producers would close the gap.

## 21 October 2026

- **Factory**: a new Bottlenecks section names what holds each underfed or backed-up machine back, including the belt that caps a flow.
- **Map**: filters for resource types, free or in-use nodes, and building states. Resource nodes use the game's own icons. Rails and resource nodes join the map.
- **Settings**: alerts can be sent to your devices as push notifications.
- **Settings**: you can leave a server, or delete your account.
- **Privacy**: the privacy policy and terms of use are published.

## 20 October 2026

- **Factory**: a machine held up by a full output, with every input full, now reads backed up instead of underfed.
- **Map**: buildings are drawn as small machine icons.
- A new logo, header and front page.

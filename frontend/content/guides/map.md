---
title: The Map page and its layers
description: What each layer on Satis Manager's map shows, from buildings and trains to drone ports and belts, how the filters work, and how to read the tables.
order: 9
updated: 2026-11-03
---
The Map page places your factory where it really is in the world. Each machine sits at its in-game position on a grid in metres, over a traced outline of the game's terrain, and layers add rails, trains, resource nodes, markers and more. It's handy for finding a machine the bottleneck list names, checking which resource nodes you still haven't tapped, or seeing at a glance where the trains are.

## Moving around

Drag to pan and scroll or pinch to zoom, as on any web map. The grid lines are 500 m apart. Hover over or tap a building, station or port to see its name and details.

Every position on the page is in metres, the same "near (x, y)" numbers you see in the [bottleneck list](/guides/bottlenecks). So if a finding says "near (120, −40)", the map's grid tells you where that is.

## The layers

The layer switches sit above the map. Turn each on or off. The caption under the map lists what's showing.

| Layer | On at start | What it shows |
|---|---|---|
| **Buildings** | yes | Each production machine as a small machine icon, coloured by state |
| **Rails** | yes | Railway track, segment by segment |
| **Resource nodes** | yes | Ore and other nodes, drawn with the game's own resource icons |
| **Trains** | yes | Live train positions and train stations |
| **Markers** | yes | The map markers and stamps players placed in the game |
| **Drone ports** | yes | Each drone port and the routes between paired ports |
| **Power lines** | no | Every power line, as a thin copper line |
| **Belts and pipes** | no | Conveyor belts, lifts and pipes |

Power lines and belts are off at the start because a big save has thousands of them, drawn right where your buildings are. They're only read from the server once you turn them on.

### Buildings

A building's colour says its state:

- **Producing**: green.
- **Not producing**: grey.
- **Paused**: blue. Blue is used only for paused.
- **No recipe**: grey, but drawn as an outline only, so you can tell it from "Not producing" by shape.

A **backed-up** machine gets a thin amber ring around its icon. Backed up isn't a separate state on the map; it's a mark on top of the state. The [Factory guide](/guides/factory) explains what backed up means and why it's often fine.

### Trains

Trains are the one layer that moves. Their positions are read every 10 seconds. The train table shows each train's status in the game's own words. If the server can't be reached, the page says these are the last known positions.

### Markers

Markers are drawn as pins and stamps as diamonds, in the colour the player picked in the game. A marker with no name reads "Unnamed marker". The names players type in the game, for markers, stations and trains, are shown only to the members of your server.

### Drone ports

Each port is a small square, and a dashed line joins paired ports. Hover over a port to see what it's paired with and what it carries. If a pairing can't be matched to exactly one port, no route is drawn and the text under the map counts how many weren't matched, so a missing route never goes unnoticed.

### Power lines

All lines are drawn as one thin layer, and the text says how many there are and how much wire they add up to in metres.

### Belts and pipes

The dashboard keeps where each belt or pipe starts and what it's joined to, not its curve. So the map draws each one as a straight line between its two ends. Belts and pipes have different colours, and lifts, which run straight up or down, are shown as dots. An end that can't be placed is a dot too. The text gives the counts and the measured lengths, and says that they're drawn straight.

## Filters

Under the layer switches is a **Filters** panel:

- **Resource types**: one check per type, with its icon and a count. **All** and **None** buttons set them at once.
- **Resource nodes in use or free**: **All**, **Free only** or **In use only**. "Free only" is a quick way to find untapped nodes near your base.
- **Building states**: show or hide producing, not producing, paused and no-recipe buildings.

When a filter hides some items, the text says "N of M shown" so you know the rest are hidden, not missing.

## The tables

Everything the map draws is also written out as text. Under the map are tables of what's in the current view: **Buildings in view** (with each building's recipe), plus tables for resource nodes (with purity), rails, trains, stations, markers, drone ports, power lines, and belts and pipes for the layers that are on. Pan or zoom and the tables follow.

The tables are useful in their own right:

- Zoom into an area and read the **Buildings in view** count to see how many machines a corner of the base has.
- Turn on **Free only** and read the resource node table for positions and purity.
- Use the trains table to see every train's status at once, instead of hovering one by one.

A long table scrolls inside its own box, with a "Scroll for more" line while rows are hidden below.

## How fresh is it?

Machines are read about every 30 seconds and trains every 10 seconds. World layers that rarely change, such as power lines and belts, are read less often, up to every 10 minutes. A belt you built a moment ago may take a few minutes to appear.

## A few tips

- **Finding a bottleneck.** Take the "near (x, y)" from the Factory page's bottleneck list and look for an amber ring there.
- **Planning an expansion.** Turn off Buildings and Rails, set nodes to **Free only**, and pick a spot.
- **Checking a train network.** Leave only Rails and Trains on. Stations show on the trains layer.
- **On a phone.** Fewer layers make the map easier to read. The tables work well on small screens.

The map's outline and icons come from the game, which belongs to Coffee Stain Studios. Satis Manager isn't affiliated with them.

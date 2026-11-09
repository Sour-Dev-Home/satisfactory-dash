---
title: Getting started with Satis Manager
description: What Satis Manager shows, who it is for, and how to try the demo, sign in and add your first Satisfactory dedicated server.
order: 1
updated: 2026-11-09
---
Satis Manager is a web dashboard for a Satisfactory dedicated server. It reads your running game and shows, in a browser, how the factory is doing: the power on every circuit, what each machine is making, which machines are stuck, how items flow between your factories, and where everything sits on the map. You can check it from your phone while you're away from the game, or keep it open on a second screen while you build.

This guide covers what the dashboard is for, how to look around without setting anything up, and the first steps to connect your own server.

## Who it's for

- **People who run a dedicated server**, at home or on a rented host, and want to know whether the factory is still running while nobody is logged in.
- **Groups who share a server** and want one place to see power and production without walking the whole base.
- **Players who like numbers**: rates per minute, history charts, and a graph of how items move from one factory to the next.

Satis Manager doesn't play the game for you. It doesn't build, move or delete anything in your world. The only setting it can change on your server is auto-pause, and only when you ask it to. The [FAQ](/guides/faq) explains what it reads and what it never touches.

## Try the demo first

The quickest way to see every page is the live demo at demo.satis-manager.com. It runs the full dashboard on a made-up factory. There's no account and nothing to install: press **Enter demo** and you're in.

The demo answers every request inside your browser. Nothing you click there reaches a real game server, so feel free to poke at everything, including the auto-pause switch. The front page of the main site also has a short walkthrough video of the demo, with a written list of what it shows.

## Sign in

Open the dashboard at /app and choose **Sign in with Google**.

Sign-in is invite-only during the beta. If your Google account isn't on the list yet, the sign-in page tells you so instead of creating an account.

The first time an invited account signs in, you accept the Terms of Use to create your account. Accounts made this way don't keep your email address. You get a generated display name, such as "Player-4F2K", which is what the other members of a shared server see. The [privacy policy](/privacy) lists everything the service stores and why.

## Add your server

If you don't have a server in the dashboard yet, the app asks you to add one. If you already have one, the same form is under **Settings**, in the **Your server** section, as **Add your server**. Adding your own server may not be open to every account during the beta; if it isn't, the form says so.

1. Type a name for the server, for example "Our factory", and press **Add server**.
2. The app takes you to **Settings**, to the **Satis Manager mod** section, where your server's connection lives.
3. Press **Create enrolment code**. You get a 12-character code such as AB3D-7XQ2-K5MN. It works once and lasts 10 minutes.
4. Paste that code into the Satis Manager mod's config file on your dedicated server. [Connecting a server](/guides/connecting-a-server) walks through installing the mod and where the code goes.

A server that hasn't connected within 24 hours of adding it is removed automatically, so you don't collect empty entries. If the code runs out first, create a new one.

Running mod 0.3.0 or later, and it printed a pairing code in your server's console? Use the **Pair it** link next to the form, type the code, check the details and approve it.

## Find your way around

Once a server is connected, the tabs across the top are:

- **Overview**: one status summary for the whole server, with players and power at a glance. See [Reading the Overview](/guides/overview-and-status).
- **Power**: every circuit's production, consumption, capacity and batteries, with history charts. See [the Power page](/guides/power).
- **Factory**: every machine, its recipe and its state, grouped by factory, plus bottlenecks and production history. See [the Factory page](/guides/factory).
- **Planner**: a graph of your factories and the items flowing between them. See [the Planner](/guides/planner).
- **Map**: buildings, rails, trains, resource nodes and more, at their positions in the world. See [the Map page](/guides/map).
- **Settings**: auto-pause, your server's connection, alerts and your account.

If you belong to more than one server, the header shows the selected server's name and a **Change server** button. Press **Search (Ctrl+K)** to open the command bar and jump to any page by typing.

## How fresh is the data?

The mod on your server reads the game on a fixed rhythm. Today that is every 5 seconds for the server status and power, and every 30 seconds for the factory. Belt and pipe connections change less often and are read every 10 minutes. Every panel shows how old its reading is.

Two things can make the numbers stand still:

- **The game is paused.** A dedicated server can pause itself when no players are connected. While it's paused, values are frozen and the Overview says "Paused". This is normal and not a fault.
- **The server can't be reached.** If readings stop arriving, the dashboard keeps showing the last ones it had, says "Showing last known data", and dims the panels that are out of date.

## Where to go next

- New to the setup? Read [Connecting a server](/guides/connecting-a-server).
- Want to fix a slow production line? Read [Finding and fixing bottlenecks](/guides/bottlenecks).
- Curious what changed recently? See the [changelog](/changelog).

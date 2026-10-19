Source: https://github.com/satisfactorymodding/Documentation/blob/d35cc911d6849cb39740cb884735ec5d9ffb2f67/modules/ROOT/pages/Development/Satisfactory/PowerNetwork.adoc (rendered: https://docs.ficsit.app/satisfactory-modding/latest/Development/Satisfactory/PowerNetwork.html)
Captured: 2026-10-19T19:59:13Z
Method: the file at the pinned commit (the same Documentation commit as the 2026-09-27 G0 captures) through the GitHub API (`gh api repos/satisfactorymodding/Documentation/contents/<path>?ref=<commit>` with the raw media type); passages copied unedited from the AsciiDoc source. The page is 99 lines.
Excerpts only: Only quoted excerpts are committed. The SML Documentation repository has no licence that permits redistributing it, so the full text stays verifiable at the pinned URL.
Item: ADR-0039 G0 addendum (#452): the source for claim C5 (read one power value that matches FRM `getPower`).
FINDINGS (names the page cites; none is claimed to exist in the game's headers, which is spike S3's job):
  - Classes: `UFGPowerCircuit` ("gathers data about the current production and consumption of the network"), `UFGPowerConnectionComponent`, `UFGPowerInfoComponent` (E2). Section headings name them without the `U` prefix: `FGPowerConnectionComponent`, `FGPowerInfoComponent` (E3, E4).
  - Members and values, given only as display labels, not as C++ identifiers: on the connection component the page lists "M Max Num Connection Links", "M Is Hidden Connection", "M Wires", "M Nb Wires connected", "M Circuit ID" and "M Hidden Connections" (only "M Circuit ID", which links a connection to its circuit, is excerpted, E3); "Target consumption", "Base Production", "Dynamic Production Capacity", "Actual Consumption", "Regulated Dynamic Production", "Has Power" (E4). E4 says these are set and read through "the provided member functions (nodes)", which it does not name.
  - Threading: changes to a machine's power settings should be made in the Factory Tick (E1).
NOT FOUND (recorded, not guessed):
  - Any C++ function name or signature: the page names no function, header or include path.
  - A circuit-wide total (consumption or production) as a named value: `UFGPowerCircuit` is described as gathering it, with no accessor named. "Actual Consumption" is described on `FGPowerInfoComponent`, a single consumer or producer.
  - How a mod finds a circuit or a power info component (subsystem, lookup or iteration).
  - Any statement about dedicated servers, or about the page's game version. The page opens "We currently don't really know how the power network works" (E1).
---

### E1 — Opening and the Factory Tick warning (lines 1-11)

```adoc
= Power-Network

We currently don't really know how the power network works, but we do
know how we can use it, and in this chapter, we explain it to you.

[WARNING]
====
If you want to make changes to the power settings of a machine.
(Settings values of FGInventoryComponent) and other stuff,
then you should definitely perform this call in the xref:/Development/Satisfactory/FactoryTick.adoc[Factory Tick].
====
```

### E2 — The three key components (lines 13-33)

```adoc
The Power-Network consists of three key components.

* {blank}
+
UFGPowerCircuit::
  This class manages a power network (aka. PowerCircuit) itself. It
  gathers data about the current production and consumption of the
  network and decides what needs to happen.
* {blank}
+
UFGPowerConnectionComponent::
  This is the component used to connect components/machines. It manages
  cable connections and hidden connections from other connection
  components to itself. It f.e. limits the number of cables you can
  attach to it.
* {blank}
+
UFGPowerInfoComponent::
  This component represents the needs of a power consumer/producer
  itself (like production, consumption). If you want to know if
  your machine has power or make it consume power, you will need to use this component.
```

### E3 — FGPowerConnectionComponent: its heading and the circuit ID (lines 35-38, 56-59)

```adoc
== FGPowerConnectionComponent

This class manages is a connection point for wires and hidden
connections to "transfer" energy.
[... skipped ...]
* {blank}
+
M Circuit ID::
  The ID of the connected power circuit
```

### E4 — FGPowerInfoComponent (lines 65-99)

```adoc
== FGPowerInfoComponent

This class handles and contains information about the needs and status
of a power consumer/producer.

You need to use the provided member functions (nodes) to set/get data
like:

* {blank}
+
Target consumption::
  The amount of power the power consumer needs to work
* {blank}
+
Base Production::
  The amount of power the producer produces definitely (like a
  geothermal generator) and doesn't get decreased dynamically like a
  fuel generator.
* {blank}
+
Dynamic Production Capacity::
  The max amount of power the producer can provide. (used to limit the
  dynamic production)
* {blank}
+
Actual Consumption::
  The consumption used in the last tick of the power grid.
* {blank}
+
Regulated Dynamic Production::
  The amount of power provided to the power circuit in the last tick.
* {blank}
+
Has Power::
  If the consumer has actual power
```

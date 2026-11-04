# ADR-0064: Skimmable pages: cut what repeats or says "normal", fold the Factory table (amends ADR-0062 F and ADR-0027)

Status: **Accepted** (owner, 2026-11-03). The owner: "I'm just a bit overwhelmed by the amount of info on most pages and think
we should skim", "the dropdowns look a bit odd and cluttered", then "any info we can cut out that isn't high value", and on
the proposal below: "yes write the ADR and start with factory". The owner was offered every cut listed here and kept none
back; folding the groups and merging identical machines were recommended and taken. No contract change. Paths are relative
to `frontend/src/` unless they say otherwise.

## Context

Read from the code and the e2e screenshots (`default.png`, `default-power.png`, `default-factory.png`, `factory-grouped.png`),
not from a usability test. Three patterns make the pages hard to skim:

- **The same fact twice.** Factory lists its bottlenecks at the top (`factory/BottleneckSummary.tsx`) and again at the bottom
  (`factory/BottlenecksPanel.tsx`); its machine summary line ("5 machines · 2 backed up · 0 paused · 1 without a recipe",
  `factory/FactoryPanel.tsx:125-127`) repeats the filter chips' counts. Overview's "Server status" card
  (`status/StatusPanel.tsx`) repeats the save and players of the Health card's Server tile; its Power card repeats the Power
  tile. A bottleneck's "Capped by: Conveyor Belt Mk.1 · 60 items/min · near (…)" line repeats the sentence above it: the
  backend's sentence always names the conveyor, its rate and its place when there is one
  (`backend/src/modules/telemetry/services/bottleneckFinder.ts:709-712`).
- **"Normal" spelled out.** Every healthy machine says "Producing" in green; every group repeats the table's column headers
  (one `<table>` per group, ADR-0062 F.2); each group and factory is a button-styled disclosure (`ui/Disclosure.tsx`), nested
  two deep, so a healthy factory reads as a wall of pills and headers. Filter chips show "Paused 0". "Since yesterday" keeps a
  tall reserved box to say "Not enough history yet". The tick line ("Tick 21.4/s · Healthy" and a bar) shows when the tick is
  fine; "Running with warnings" restates DEGRADED.
- **Plumbing notes.** "Connections refresh every 10 minutes", "Machines changed state 2+ times in the last 24 h", "A break in
  the line means nothing was recorded then…", "(min …, max …)" after each power figure, "Circuit 0" and "OK" on a save with one
  healthy circuit, and an "Updated 8 s ago" line in every panel.

Two numbers also disagree: the Overview's Power tile says production of capacity (`overview/health.ts:74`, "3,633.3 MW of
4,083.3 MW capacity") and the Power card under it says consumption of capacity (`overview/cards/PowerCard.tsx:69`, "2,915.6 MW
of 4,083.3 MW"), in the same words.

(One thing checked and set aside: on the screenshots the history sentence says "last 7 days" with 24 h picked. The sentence
uses the range the response names, and the test mock answers every range with the 7-day fixture
(`test/handlers.ts:68`); the real backend answers the range asked for. Not a bug.)

## Decisions

### 1. The rules

1. **Normal is quiet.** Only an exception gets a colour or a word: a healthy machine, circuit, tick or filter at 0 says nothing.
2. **One fact, one place.** A count or a reading is shown once per page; a summary that has a fuller form opens to it in place.
3. **An empty state is one line, or nothing.** No reserved box stands empty once the page has loaded.
4. **Details fold.** What explains the data (how it is read, what a gap means) sits in a disclosure, not in the page's flow.
5. **The text path stays whole.** Every cut is from what is drawn, never from the words a screen reader or the readings tables
   give; nothing that was reachable becomes unreachable (it may move behind a disclosure).

### 2. Factory: cuts (build PR 1)

- **Bottlenecks: one card, at the top.** The summary stays first in its fixed box (ADR-0062 F.1, ADR-0032's shift budget). Its
  "Full list" link becomes a button of the same words (`aria-expanded`) that opens the full list in the same card, in place
  of the summary lines (so no cause is shown twice); the separate "Bottlenecks" panel at the page's end goes. With no
  causes the button still shows when there is a note (an older FRM, belt data missing), which the list holds. A link to `#bottlenecks` (the Planner's, the command bar's)
  opens the list and jumps to it, as it jumps today. The summary lines drop the place ("near (−560, −1290)"); the full list
  keeps it.
- **Fewer bottleneck lines.** The "Capped by" line goes (the sentence says it). A finding whose gap is under 2% of what is
  wanted (`isSmallGap`, which today adds "may be clock rounding") is left out of the count, the summary and the list. The
  "Connections refresh every N minutes" note goes; the notes that say why data is missing (belt data modes, an older FRM)
  stay.
- **Since yesterday shows only when it has something to say:** enough history and at least one notable drop or rise. Otherwise
  the card is not drawn. Its "Machines changed state N times" line goes, and with it the transitions read
  (`sinceYesterdayQueries`, `shell/pageQueries.ts`). It moves to the **end of the page**, after the production history: the
  reveal waits for its read, so usually it is known before anything paints, but a read late past the reveal budget keeps its
  reserved box while it loads and then may go, and at the end that moves nothing above it (ADR-0032's shift budget; the
  tab-switch e2e's slow-history variant). The page's skeleton no longer draws its box.
- **The machine panel's header.** The summary line goes (the chips carry the counts). A state chip with a count of 0 is not
  drawn unless it is pressed (a `?state=` link can press one). The in-page nav (Machines, History, Bottlenecks, ADR-0062 F.4)
  goes: with the bottlenecks at the top and two sections left, it is a jump within one scroll. Its anchors (`#machines`,
  `#history`, `#bottlenecks`) keep working for links.
- **History.** "A break in the line means…" moves into the "Readings table" disclosure, as its first line.

### 3. Factory: one folded table (build PR 2)

Supersedes ADR-0062 F.2's "each group is its own table" and its heading disclosures; the grouping itself (factories, parts,
groups, "Other machines", from the Planner's reads) is unchanged.

- **One table, one header row.** The grouped machines are one `<table>` (Machine, Recipe, Inputs when sent, Outputs, State).
- **A factory is a row,** across the table: a disclosure button with its name, then its counts ("· 11 machines · 1 backed up").
  Factories start **folded**, except when there is only one top-level factory (folding the only one hides everything) and while
  a filter or search is on (as today, so a search shows its hits). A part of a parent factory is a factory row one step in.
- **A group is one row:** "4× Smelter" in the Machine column, its recipe, its outputs summed over its machines per item
  ("120 / 120 items/min (100%)": current and max added, the percent of the sums), and its state column counts what is not
  normal ("1 backed up"). Its disclosure lists its machines under it, one step in, capped at `FACTORY_ROW_CAP` (50) with "Show
  all" as today. A group of one machine is that machine's own row. While filtering, a group with a match starts open.
- **Normal says nothing.** The State column is empty for "Producing"; every other state keeps its word, tone and mark. An output
  whose item is the recipe's own name drops the name ("Iron Ingot: 30 / 30" becomes "30 / 30 items/min (100%)") when it is the
  machine's only output.
- The phone's stacked rows are the same rows. Indentation is by Tailwind's spacing scale, from `sm` only (as today).
- The flat table (no graph, or a graph naming none of the machines) is unchanged but for the State and Outputs rules above.

### 4. Overview (build PR 3)

- **The "Server status" card goes** (`status/StatusPanel.tsx` from the Overview). The save and players are the Server tile's;
  total play time joins that tile's line; the data age is the page's (Decision 6).
- **The Power tile shows consumption,** as the Power card does, so the page has one power number; with the card beside it the tile
  says only its circuits ("1 circuit", or what is wrong), and the card keeps the bar and "X MW of Y MW".
- **The Players card** with nobody on draws no empty figures: it says "No players connected (4 slots)" on one line.
- **The tick line** shows only when the tick is slow or no game is running; a healthy tick says nothing (it still counts in the
  overall health).
- **The headline's subtitle** shows only when it names causes; the generic ones (`HEADLINE` in `overview/health.ts`: "Running with warnings", "All systems operational" and the rest, each
  a restatement of the word above it) go.

### 5. Power (build PR 4)

- **A circuit says consumption of capacity** and, when it applies, the overload warning. Production and peak demand move into
  a "Details" disclosure in the circuit card.
- **One healthy circuit:** no "Circuit 0" heading and no "OK"; a circuit's status word shows only when it is not OK. With
  several circuits each keeps its name.
- **The history's "(min …, max …)"** after each figure goes; the chart and its readings table show the range.

### 6. Freshness once (build PR 5)

The per-panel "Updated N s ago" lines (`components/DataAge.tsx` in Factory, Planner, Power and the Overview's Server status)
become one, beside the server picker, for the page's primary read (`shell/pageQueries.ts`). A panel shows its own age only when
its data is late (stale, or its last refresh failed), as `DataAge`'s `late` already marks. Until PR 5 the panels keep theirs.

## Build plan (each PR from `main`, no stacking)

| PR | What | Checks |
|---|---|---|
| 1 | This ADR; Decision 2 | RTL: the merged bottleneck card (open, closed, `#bottlenecks`), small gaps left out, Since yesterday's empty case, zero chips; e2e and screenshots of the Factory states; `ui-reviewer`, `test-hunter` |
| 2 | Decision 3 | RTL over the grouping fixtures: folded and open, one header, group sums, a one-machine group, filtering opens, the cap per group; axe; screenshots; `ui-reviewer`, `test-hunter` |
| 3 | Decision 4 | RTL and screenshots of the Overview states; the tile and the card agree |
| 4 | Decision 5 | RTL and screenshots of the Power states |
| 5 | Decision 6 | RTL: one age, a late panel's own line; e2e states |

No flag: each PR removes or folds what is drawn and keeps every text path.

## Consequences

- The pages get shorter and their colour means something again; a reader who wants the full numbers opens a disclosure.
- ADR-0062 F.1 (two bottleneck parts), F.2's per-group tables and F.4's in-page nav are superseded; F.3 (state marks and
  toggles) and F.5 (the row cap) stay.
- Leaving small gaps out means a site whose only bottleneck is clock rounding shows "All machines are fed and flowing."
- The transitions read leaves the Factory page, one read fewer per poll.

## Not decided / later

The Planner, Map, Settings, Servers and Metrics pages are not covered; the same rules apply when they are next touched, each
with the owner.

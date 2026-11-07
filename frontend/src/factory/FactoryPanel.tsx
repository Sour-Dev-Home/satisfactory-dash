import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import {
  isBackedUpState,
  type FactoryBuilding,
  type FactoryResponse,
  type PlannerDesignation,
  type ProductionGraph,
  type ProductionRate,
} from "@satisfactory-dash/shared";
import { formatPercent, formatRate, formatTime } from "../format";
import { PanelAge } from "../components/DataAge";
import { tour } from "../demo/tour/target";
import { cn } from "../lib/cn";
import { MACHINES_ANCHOR, type FactoryStateFilter } from "../lib/deepLinks";
import { useHashTarget } from "../lib/useHashTarget";
import { StateMark } from "../planner/graph/StateMark";
import { isStalledKind, type StalledKind } from "../planner/plannerText";
import { Chevron, TreeHeading } from "../ui/Disclosure";
import { useDisclosures } from "../ui/useDisclosures";
import {
  backedUpIn,
  groupMachines,
  groupTitle,
  narrowGrouping,
  notableStates,
  OTHER_MACHINES_KEY,
  stateCounts,
  sumRates,
  type MachineFactory,
  type MachineGroup,
  type MachineGrouping,
} from "./machineGroups";
import { ShowAllRows } from "./ShowAllRows";
import { matchesStates, STATE_FILTERS, toggleState } from "./stateFilters";
import { useRowCap } from "./useRowCap";

const isMachinesAnchor = (id: string) => id === MACHINES_ANCHOR;

/** ADR-0062 F.5: the table's first render shows this many machines, then "Show all", so the page height is bounded. */
export const FACTORY_ROW_CAP = 50;

/**
 * Presentational: one factory snapshot, with in-memory filter and search. Backed-up is
 * information, not an alarm: on a real save a large share of machines is backed up in
 * normal steady-state play, so it's a count and a filter, never a red banner.
 * `refetchFailed`: the last refresh failed, so this snapshot is what the cache kept.
 * `search`/`onSearch`: the view keeps the search in the URL (?q=, #351); without them it's local.
 * `states`/`onStates`: the state filters that are on (ADR-0062 F.3), which the view keeps in the URL (?state=); without them
 * they're local.
 * `graph`, `designations`: the Planner's reads (ADR-0062 F.2), which group the table by factory and group;
 * without the graph the table is flat. `groupsUnavailable`: the graph read failed, so the table says why it is flat.
 */
export function FactoryPanel({
  snapshot,
  refetchFailed = false,
  search: searchProp,
  onSearch,
  states: statesProp,
  onStates,
  graph,
  designations,
  groupsUnavailable = false,
}: {
  snapshot: FactoryResponse;
  refetchFailed?: boolean;
  search?: string;
  onSearch?: (search: string) => void;
  states?: readonly FactoryStateFilter[];
  onStates?: (states: FactoryStateFilter[]) => void;
  graph?: ProductionGraph | undefined;
  designations?: readonly PlannerDesignation[] | undefined;
  groupsUnavailable?: boolean;
}) {
  useHashTarget(isMachinesAnchor);
  const { buildings } = snapshot.data;
  const backedUpCount = buildings.filter(isBackedUpState).length;
  const [localStates, setLocalStates] = useState<FactoryStateFilter[]>([]);
  const states = statesProp ?? localStates;
  const setStates = onStates ?? setLocalStates;
  const [localSearch, setLocalSearch] = useState("");
  const search = searchProp ?? localSearch;
  const setSearch = onSearch ?? setLocalSearch;

  const needle = search.trim().toLowerCase();
  const filtering = states.length > 0 || needle !== "";
  const match = (b: FactoryBuilding) =>
    matchesStates(b, states) && (!needle || b.name.toLowerCase().includes(needle) || (b.recipe ?? "").toLowerCase().includes(needle));
  const shown = buildings.filter(match);
  // ADR-0062 F.2: grouped by the Planner's factories and groups; null (no graph yet, or one naming none of these machines)
  // shows the table flat, as one group.
  const grouping = useMemo(() => groupMachines(buildings, graph, designations), [buildings, graph, designations]);
  const narrowed = grouping === null ? null : narrowGrouping(grouping, filtering ? match : null);
  // ADR-0062 F.5: the cap applies per group, after the filter and search, so a search reaches a machine past it. A new filter
  // or search caps every group again.
  const resetKey = `${states.join(",")}\n${needle}`;
  const paused = buildings.filter((b) => b.isPaused).length;
  const noRecipe = buildings.filter((b) => b.recipe === null).length;
  const counts = new Map<FactoryStateFilter, number>([
    ["backedUp", backedUpCount],
    ["paused", paused],
    ["noRecipe", noRecipe],
  ]);
  // An older backend sends no ingredients at all: no Inputs column rather than an empty one.
  const showInputs = buildings.some((b) => b.ingredients !== undefined);

  return (
    // data-stale: dimmed while the game is unreachable and this is its last reading (ADR-0052; index.css).
    // id: a link's target (#machines); scroll-mt leaves a gap above the heading when it jumps here.
    <section
      id={MACHINES_ANCHOR}
      aria-labelledby="factory-heading"
      className="panel scroll-mt-4"
      data-stale={snapshot.unreachableSince !== undefined ? "" : undefined}
      {...tour("factory-machines")}
    >
      <h3 id="factory-heading">Factory</h3>
      {snapshot.stale && <p>Showing last known factory data from {formatTime(snapshot.observedAt)}.</p>}

      {buildings.length === 0 ? (
        <p>No machines yet.</p>
      ) : (
        <>
          {/* No summary line (ADR-0064): the filter toggles carry the counts. */}
          <div data-sticky-scope="" className={STICKY_SCOPE}>
            <FilterBar
              search={
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  Search machines
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              }
              filters={
                // ADR-0062 F.3: the counts as toggles. "All" turns every filter off; each state turns on and off on its own,
                // and with several on the table shows a machine matching any of them. A state at 0 is not drawn unless it is
                // on (a ?state= link can turn one on), so it can still be turned off (ADR-0064).
                <div role="group" aria-label="Filter machines">
                  <FilterToggle label="All" count={buildings.length} pressed={states.length === 0} onClick={() => setStates([])} />
                  {[...STATE_FILTERS].filter(([id]) => (counts.get(id) ?? 0) > 0 || states.includes(id)).map(([id, f]) => (
                    <FilterToggle
                      key={id}
                      label={f.label}
                      mark={f.mark}
                      count={counts.get(id) ?? 0}
                      pressed={states.includes(id)}
                      onClick={() => setStates(toggleState(states, id))}
                    />
                  ))}
                </div>
              }
            />

            {groupsUnavailable && <p className="m-0 text-sm text-muted">{GROUPS_UNAVAILABLE}</p>}
            {shown.length === 0 ? (
              <p>No machines match.</p>
            ) : narrowed === null || grouping === null ? (
              <MachineTable rows={shown} showInputs={showInputs} resetKey={resetKey} />
            ) : (
              <FoldedTable grouping={narrowed} filtering={filtering} showInputs={showInputs} resetKey={resetKey} />
            )}
          </div>
        </>
      )}

      <PanelAge observedAt={snapshot.observedAt} late={snapshot.stale || refetchFailed} />
    </section>
  );
}

/**
 * The box the filter bar sticks within: the bar and the table, in a flex column. Not the `.panel` grid itself: a sticky
 * grid item is bounded by its own grid area, which is one auto row exactly the bar's height, so it would never move.
 * The gap is the panel's.
 */
const STICKY_SCOPE = "flex min-w-0 flex-col gap-3";

/**
 * ADR-0062 F.4: the table's controls in one bar that sticks to the top of the screen while the table scrolls under it
 * (one sticky layer, never two stacked). Sticky is bounded by `STICKY_SCOPE`, so it lets go once the table has scrolled
 * past; no ancestor up to the page scrolls on its own (an `overflow` there would turn sticky off). On a phone only the
 * search sticks: the outer box becomes `contents`, which makes the search row a child of the scope and lets it stick
 * there, while the state filters above it scroll away. From `sm` the outer box sticks as one row, the filters first and
 * the search at its end (ADR-0064: the in-page nav that had a row of its own went).
 */
function FilterBar({ search, filters }: { search: ReactNode; filters: ReactNode }) {
  return (
    <div
      data-filter-bar=""
      className="contents sm:sticky sm:top-0 sm:z-(--z-sticky) sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-2 sm:border-b sm:border-line sm:bg-surface sm:py-2"
    >
      {filters}
      <div className="flex items-center max-sm:sticky max-sm:top-0 max-sm:z-(--z-sticky) max-sm:border-b max-sm:border-line max-sm:bg-surface max-sm:py-2">
        {search}
      </div>
    </div>
  );
}

/**
 * One state filter (ADR-0062 F.3): a toggle button (`aria-pressed`) with the Planner's mark for its state and its count, so
 * its name reads "Backed up 24". Pressed, the button is the accent fill, so the mark takes the button's text colour there.
 */
function FilterToggle({
  label,
  mark,
  count,
  pressed,
  onClick,
}: {
  label: string;
  mark?: StalledKind;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className="inline-flex items-center gap-1.5">
      {mark !== undefined && <StateMark kind={mark} toned={!pressed} />}
      {label} <span className="font-normal tabular-nums">{count}</span>
    </button>
  );
}

const GROUPS_UNAVAILABLE = "The Planner's factories could not be read, so the machines are listed in one table.";

const machines = (n: number) => `${n} ${n === 1 ? "machine" : "machines"}`;

/** The machine table's one header row (ADR-0064: one header for the whole table, grouped or flat). */
function TableHead({ showInputs }: { showInputs: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col">Machine</th>
        <th scope="col">Recipe</th>
        {showInputs && <th scope="col">Inputs</th>}
        <th scope="col">Outputs</th>
        <th scope="col">State</th>
      </tr>
    </thead>
  );
}

/**
 * The flat table, while there is nothing to group by (no graph, or a graph naming none of these machines), capped at
 * `FACTORY_ROW_CAP` rows (ADR-0062 F.5).
 */
function MachineTable({ rows, showInputs, resetKey }: { rows: readonly FactoryBuilding[]; showInputs: boolean; resetKey: string }) {
  const rowCap = useRowCap(rows, FACTORY_ROW_CAP, resetKey);
  return (
    <>
      <table>
        <TableHead showInputs={showInputs} />
        <tbody>
          {rowCap.visible.map((building, i) => (
            // id is unique within one response; never persisted (stability unverified).
            <BuildingRow
              key={building.id}
              building={building}
              showInputs={showInputs}
              level={0}
              focusRef={rowCap.expanded && i === FACTORY_ROW_CAP ? rowCap.firstRevealedRef : undefined}
            />
          ))}
        </tbody>
      </table>
      <ShowAllRows rowCap={rowCap} noun="machines" />
    </>
  );
}

interface FoldState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  filtering: boolean;
  showInputs: boolean;
  resetKey: string;
  /** The table's column count, for the rows that span it (a factory's, "Show all"). */
  columns: number;
}

/** A group's disclosure key: apart from a factory's (a node key and a factory key are different kinds of server string). */
const groupKeyOf = (key: string) => `group\u0001${key}`;

/**
 * How far a row steps in from the table's edge by its depth, from `sm` (a phone stacks the rows full width). Tailwind's
 * spacing scale; a level past the last keeps the last.
 */
const indentOf = (level: number) => (level <= 0 ? "" : level === 1 ? "sm:ps-8" : level === 2 ? "sm:ps-14" : "sm:ps-20");

/**
 * ADR-0064 Decision 3: the grouped machines as one folded table under one header. A factory is a row across the table (its
 * name a disclosure button, then its counts); a group is one row ("4× Smelter", its recipe, its rates summed, the states
 * worth a word counted) that opens to its machines; a group of one machine is that machine's row; "Other machines" is a
 * factory-like row. Everything starts folded, except the only top-level row (folding it would hide everything) and, while a
 * filter or search is on, everything (so the hits show). The viewer's own choices are kept (`useDisclosures`).
 */
function FoldedTable({
  grouping,
  filtering,
  showInputs,
  resetKey,
}: {
  grouping: MachineGrouping;
  filtering: boolean;
  showInputs: boolean;
  resetKey: string;
}) {
  const topKeys = [
    ...grouping.factories.map((f) => f.key),
    ...grouping.groups.map((g) => groupKeyOf(g.key)),
    ...(grouping.other.length > 0 ? [OTHER_MACHINES_KEY] : []),
  ];
  const onlyKey = topKeys.length === 1 ? topKeys[0] : undefined;
  const defaultOf = useCallback((key: string) => filtering || key === onlyKey, [filtering, onlyKey]);
  const { isOpen, toggle } = useDisclosures(defaultOf);
  const state: FoldState = { isOpen, toggle, filtering, showInputs, resetKey, columns: showInputs ? 5 : 4 };
  return (
    <table data-machine-groups="" aria-label="Machines by factory">
      <TableHead showInputs={showInputs} />
      <tbody>
        {grouping.factories.map((f) => (
          <FactoryRows key={f.key} factory={f} level={0} state={state} />
        ))}
        {grouping.groups.map((g) => (
          <GroupRows key={g.key} group={g} level={0} state={state} />
        ))}
        {grouping.other.length > 0 && <OtherRows rows={grouping.other} total={grouping.otherTotal} state={state} />}
      </tbody>
    </table>
  );
}

/**
 * " · 24 machines · 2 backed up", or " · 3 of 24 machines" while filtering: read with the heading, outside its button, so
 * the button's name stays the same as the counts change.
 */
function Counts({ shown, total, backedUp, filtering }: { shown: number; total: number; backedUp: number; filtering: boolean }) {
  const count = filtering && shown < total ? `${shown} of ${machines(total)}` : machines(total);
  return (
    <span className="text-sm font-normal normal-case tracking-normal text-muted">
      {` · ${count}`}
      {backedUp > 0 && ` · ${backedUp} backed up`}
    </span>
  );
}

/**
 * A factory's (or "Other machines'") row across the table: a heading (h4 at the top, one deeper per level, so a screen
 * reader can move between factories) whose words are its disclosure button, then its counts.
 */
function SectionRow({
  title,
  open,
  onToggle,
  level,
  columns,
  counts,
  kind,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  level: number;
  columns: number;
  counts: ReactNode;
  kind: "factory" | "other";
}) {
  return (
    <tr data-machine-factory={kind === "factory" ? "" : undefined} data-machine-other={kind === "other" ? "" : undefined}>
      <td colSpan={columns} className={indentOf(level)}>
        <TreeHeading level={4 + level}>
          {/* No aria-controls, here or on a group's button: what it opens is the sibling rows after it, never one element
              to name; aria-expanded carries the state (`ui-reviewer`). */}
          <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex min-h-touch items-center gap-1 break-words text-left">
            <Chevron open={open} />
            {title}
          </button>
          {counts}
        </TreeHeading>
      </td>
    </tr>
  );
}

function FactoryRows({ factory, level, state }: { factory: MachineFactory; level: number; state: FoldState }) {
  const open = state.isOpen(factory.key);
  return (
    <>
      <SectionRow
        kind="factory"
        title={factory.name}
        open={open}
        onToggle={() => state.toggle(factory.key)}
        level={level}
        columns={state.columns}
        counts={<Counts shown={factory.machineCount} total={factory.total} backedUp={backedUpIn(factory)} filtering={state.filtering} />}
      />
      {open && (
        <>
          {factory.parts.map((p) => (
            <FactoryRows key={p.key} factory={p} level={level + 1} state={state} />
          ))}
          {factory.groups.map((g) => (
            <GroupRows key={g.key} group={g} level={level + 1} state={state} />
          ))}
        </>
      )}
    </>
  );
}

/** Machines no group names: the graph is older than the factory read, or its caps left them out. */
function OtherRows({ rows, total, state }: { rows: readonly FactoryBuilding[]; total: number; state: FoldState }) {
  const open = state.isOpen(OTHER_MACHINES_KEY);
  return (
    <>
      <SectionRow
        kind="other"
        title="Other machines"
        open={open}
        onToggle={() => state.toggle(OTHER_MACHINES_KEY)}
        level={0}
        columns={state.columns}
        counts={<Counts shown={rows.length} total={total} backedUp={rows.filter(isBackedUpState).length} filtering={state.filtering} />}
      />
      {open && <CappedRows rows={rows} level={1} state={state} />}
    </>
  );
}

/**
 * A group: one row for all its machines, or, for a group of one machine, that machine's own row. Opening the row lists its
 * machines under it, one step in, capped at `FACTORY_ROW_CAP` with its own "Show all".
 */
function GroupRows({ group, level, state }: { group: MachineGroup; level: number; state: FoldState }) {
  const key = groupKeyOf(group.key);
  const open = state.isOpen(key);
  const first = group.buildings[0];
  if (group.total === 1 && first !== undefined) return <BuildingRow building={first} showInputs={state.showInputs} level={level} />;
  const shown = group.buildings.length;
  const narrowed = state.filtering && shown < group.total;
  // A Planner group is one recipe, but a factory read newer than the graph can hold a machine set to another since: then
  // the row says so rather than show the first machine's (`test-hunter`), and the outputs keep their names.
  const recipes = new Set(group.buildings.map((b) => b.recipe));
  const mixed = recipes.size > 1;
  const recipe = mixed ? null : (first?.recipe ?? null);
  return (
    <>
      {/* Cells centred on the row: the name is a 44 px tall button, the other cells one line. */}
      <tr data-machine-group="" className="*:align-middle">
        <th scope="row" className={indentOf(level)}>
          <button type="button" aria-expanded={open} onClick={() => state.toggle(key)} className="inline-flex min-h-touch items-center gap-1 break-words text-left">
            <Chevron open={open} />
            {/* The whole group's count, so the row's name stays as a filter narrows it ("4× Constructor · 1 of 4"). */}
            {groupTitle(group, group.total)}
          </button>
          {narrowed && <span className="text-xs font-normal text-muted"> · {shown} of {group.total}</span>}
        </th>
        <td>{mixed ? "Several recipes" : (recipe ?? "No recipe")}</td>
        {state.showInputs && (
          <td>
            <Rates rates={sumRates(group.buildings, (b) => b.ingredients)} label="Inputs" recipe={null} />
          </td>
        )}
        <td>
          <Rates rates={sumRates(group.buildings, (b) => b.production)} label="Outputs" recipe={recipe} />
        </td>
        <td>
          <StateCounts buildings={group.buildings} />
        </td>
      </tr>
      {open && <CappedRows rows={group.buildings} level={level + 1} state={state} />}
    </>
  );
}

/** A group's (or "Other machines'") machines, capped at `FACTORY_ROW_CAP` (ADR-0062 F.5), "Show all" in a row of its own. */
function CappedRows({ rows, level, state }: { rows: readonly FactoryBuilding[]; level: number; state: FoldState }) {
  const rowCap = useRowCap(rows, FACTORY_ROW_CAP, state.resetKey);
  return (
    <>
      {rowCap.visible.map((building, i) => (
        <BuildingRow
          key={building.id}
          building={building}
          showInputs={state.showInputs}
          level={level}
          focusRef={rowCap.expanded && i === FACTORY_ROW_CAP ? rowCap.firstRevealedRef : undefined}
        />
      ))}
      {rowCap.overCap && (
        <tr data-show-all="">
          <td colSpan={state.columns} className={indentOf(level)}>
            <ShowAllRows rowCap={rowCap} noun="machines" />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * `focusRef`: on the first row "Show all" revealed, whose name takes focus (focusable from script only, never a tab stop),
 * so the reader carries on at the row after the one they stopped at. `level`: how far it steps in under its group.
 */
function BuildingRow({
  building,
  showInputs,
  level,
  focusRef,
}: {
  building: FactoryBuilding;
  showInputs: boolean;
  level: number;
  focusRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <tr>
      <th scope="row" ref={focusRef} tabIndex={focusRef ? -1 : undefined} className={indentOf(level)}>
        {building.name}
      </th>
      <td>
        {building.recipe ?? "No recipe"}
        <Clock percent={building.clockSpeedPercent} />
      </td>
      {showInputs && (
        <td>
          {/* Absent (an older backend, ADR-0007) says nothing; [] is a machine with no recipe. */}
          {building.ingredients && <Rates rates={building.ingredients} label="Inputs" recipe={null} />}
        </td>
      )}
      <td>
        <Rates rates={building.production} label="Outputs" recipe={building.recipe} />
      </td>
      <td>
        <StateTags building={building} />
      </td>
    </tr>
  );
}

/**
 * The clock speed, only when it isn't the default 100% (the owner's call, 2026-09-25). It sits
 * with the recipe, as its setting, and says "Clock" so it's never read as an output's percent.
 */
function Clock({ percent }: { percent: number | undefined }) {
  if (percent === undefined || !Number.isFinite(percent) || percent <= 0) return null;
  const text = formatPercent(percent);
  // Compare what's shown: 100.02 would read "Clock 100%", which says nothing, and a tiny
  // positive clock would read "Clock 0%", which isn't a setting.
  if (text === formatPercent(100) || text === formatPercent(0)) return null;
  return (
    <span className="block text-sm text-muted">
      {/* Read as "Stator, Clock 160%", not one run-on "Stator Clock 160%". */}
      <span className="sr-only">, </span>Clock {text}
    </span>
  );
}

/**
 * A machine's (or a group's summed) inputs or outputs, one plain line each. ADR-0064: an only output named as its recipe
 * ("Iron Ingot" from "Iron Ingot") drops the name, which the Recipe column already says; a screen reader still hears it.
 */
function Rates({ rates, label, recipe }: { rates: ProductionRate[]; label: "Inputs" | "Outputs"; recipe: string | null }) {
  // Stacked on a phone, two bare dashes under "No recipe" say nothing more: the table shows them.
  if (rates.length === 0) return <span className="max-table-rows:hidden">—</span>;
  const named = !(rates.length === 1 && recipe !== null && rates[0].name === recipe);
  return (
    <>
      {/* On a phone the table stacks and its header row is hidden: name the list there. */}
      <span aria-hidden="true" className="block text-xs text-muted table-rows:hidden">
        {label}
      </span>
      <ul aria-label={label}>
        {/* Activity is the averaged percent, never the instantaneous isProducing flag. */}
        {/* Index in the key: nothing in the contract says item class names are unique. */}
        {rates.map((rate, i) => (
          <li key={`${i}-${rate.className}`}>
            {/* unit is optional (ADR-0015): missing or null = unknown, shown as "per min". */}
            {/* "current / max unit" never splits on a phone: a line can only break before the "(%)". */}
            {named ? `${rate.name}: ` : <span className="sr-only">{`${rate.name}: `}</span>}
            <span className="whitespace-nowrap">
              {formatRate(rate.currentPerMinute, rate.maxPerMinute, rate.unit ?? null)}
            </span>{" "}
            ({formatPercent(rate.percent)})
          </li>
        ))}
      </ul>
    </>
  );
}

/** One state's word in its tone, with the Planner's mark before it when the Planner marks that state (ADR-0062 F.3). */
function StateWord({ state, tone, children }: { state: string; tone: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium", tone)}>
      {isStalledKind(state) && <StateMark kind={state} />}
      {children}
    </span>
  );
}

/**
 * The backend's state as a label, plus any flag the state doesn't already say. ADR-0064: normal says nothing, so a
 * producing machine's cell is empty. From an older backend without `state`, or with one this frontend doesn't know, just
 * the flags. A marked state wears the same `StateMark` before its word, in the same tone; the word stays, so the mark only
 * repeats it (it is `aria-hidden`).
 */
function StateTags({ building }: { building: FactoryBuilding }) {
  return notableStates(building).map(({ state, view }, i) => (
    <Fragment key={view.label}>
      {i > 0 && " "}
      <StateWord state={state} tone={view.tone}>
        {view.label}
      </StateWord>
    </Fragment>
  ));
}

/** A group's State column (ADR-0064): "1 backed up", "2 idle", only for the states worth a word. */
function StateCounts({ buildings }: { buildings: readonly FactoryBuilding[] }) {
  return stateCounts(buildings).map(({ state, view, count }, i) => (
    <Fragment key={state}>
      {i > 0 && " "}
      <StateWord state={state} tone={view.tone}>
        {count} {view.label.toLowerCase()}
      </StateWord>
    </Fragment>
  ));
}

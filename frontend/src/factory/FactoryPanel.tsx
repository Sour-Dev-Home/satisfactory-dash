import { Fragment, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
  isBackedUpState,
  type FactoryBuilding,
  type FactoryResponse,
  type PlannerDesignation,
  type ProductionGraph,
  type ProductionRate,
} from "@satisfactory-dash/shared";
import { formatPercent, formatRate, formatTime } from "../format";
import { DataAge } from "../components/DataAge";
import { cn } from "../lib/cn";
import { MACHINES_ANCHOR, type FactoryStateFilter } from "../lib/deepLinks";
import { useHashTarget } from "../lib/useHashTarget";
import { StateMark } from "../planner/graph/StateMark";
import { isStalledKind, type StalledKind } from "../planner/plannerText";
import { DisclosureHeading } from "../ui/Disclosure";
import { useDisclosures } from "../ui/useDisclosures";
import {
  backedUpIn,
  groupMachines,
  narrowGrouping,
  OTHER_MACHINES_KEY,
  startsOpen,
  type MachineFactory,
  type MachineGroup,
  type MachineGrouping,
} from "./machineGroups";
import { machineState } from "./machineState";
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
 * `nav`: the page's in-page nav (ADR-0062 F.4), shown in the filter bar so the two stick as one.
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
  nav,
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
  nav?: ReactNode;
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
    // id: the in-page nav's and a link's target (#machines); scroll-mt leaves a gap above the heading when it jumps here.
    <section
      id={MACHINES_ANCHOR}
      aria-labelledby="factory-heading"
      className="panel scroll-mt-4"
      data-stale={snapshot.unreachableSince !== undefined ? "" : undefined}
    >
      <h3 id="factory-heading">Factory</h3>
      {snapshot.stale && <p>Showing last known factory data from {formatTime(snapshot.observedAt)}.</p>}

      {buildings.length === 0 ? (
        <div data-sticky-scope="" className={STICKY_SCOPE}>
          <FilterBar nav={nav} />
          <p>No machines yet.</p>
        </div>
      ) : (
        <>
          <p className="summary">
            {buildings.length} {buildings.length === 1 ? "machine" : "machines"} · {backedUpCount} backed up · {paused} paused · {noRecipe} without a recipe
          </p>
          <div data-sticky-scope="" className={STICKY_SCOPE}>
            <FilterBar
              nav={nav}
              search={
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  Search machines
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              }
              filters={
                // ADR-0062 F.3: the summary's counts as toggles. "All" turns every filter off; each state turns on and off on
                // its own, and with several on the table shows a machine matching any of them.
                <div role="group" aria-label="Filter machines">
                  <FilterToggle label="All" count={buildings.length} pressed={states.length === 0} onClick={() => setStates([])} />
                  {[...STATE_FILTERS].map(([id, f]) => (
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
              <MachineSections grouping={narrowed} whole={grouping} filtering={filtering} showInputs={showInputs} resetKey={resetKey} />
            )}
          </div>
        </>
      )}

      <p className="as-of">
        <DataAge observedAt={snapshot.observedAt} late={snapshot.stale || refetchFailed} />
      </p>
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
 * ADR-0062 F.4: the in-page nav and the table's controls, in one bar that sticks to the top of the screen while the
 * table scrolls under it (one sticky layer, never two stacked). Sticky is bounded by `STICKY_SCOPE`, so it lets go once
 * the table has scrolled past; no ancestor up to the page scrolls on its own (an `overflow` there would turn sticky off).
 * On a phone the whole bar wraps to about four touch rows, a quarter of a 390 x 844 screen, so there only the nav and the
 * search stick (two rows): the outer box becomes `contents`, which makes the inner row a child of the scope and lets it stick there,
 * while the state filters scroll away with the table above them. From `sm` the outer box sticks with all three.
 */
function FilterBar({ nav, search, filters }: { nav?: ReactNode; search?: ReactNode; filters?: ReactNode }) {
  if (nav == null && search == null && filters == null) return null;
  return (
    <div
      data-filter-bar=""
      className="contents sm:sticky sm:top-0 sm:z-(--z-sticky) sm:flex sm:flex-col sm:gap-3 sm:border-b sm:border-line sm:bg-surface sm:py-2"
    >
      {(nav != null || search != null) && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 max-sm:sticky max-sm:top-0 max-sm:z-(--z-sticky) max-sm:border-b max-sm:border-line max-sm:bg-surface max-sm:py-2">
          {nav}
          {search}
        </div>
      )}
      {filters}
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

const GROUPS_UNAVAILABLE ="The Planner's factories could not be read, so the machines are listed in one table.";

const machines = (n: number) => `${n} ${n === 1 ? "machine" : "machines"}`;

/**
 * One list of machines (a group, "Other machines", or the whole table while there is nothing to group by), capped at
 * `FACTORY_ROW_CAP` rows (ADR-0062 F.5) by its own `useRowCap`, so every group has its own "Show all".
 */
function MachineTable({
  rows,
  showInputs,
  resetKey,
  labelledBy,
}: {
  rows: readonly FactoryBuilding[];
  showInputs: boolean;
  resetKey: string;
  /** The group's heading: each of the page's many tables is named by its group (`ui-reviewer`). */
  labelledBy?: string;
}) {
  const rowCap = useRowCap(rows, FACTORY_ROW_CAP, resetKey);
  return (
    <>
      <table aria-labelledby={labelledBy}>
        <thead>
          <tr>
            <th scope="col">Machine</th>
            <th scope="col">Recipe</th>
            {showInputs && <th scope="col">Inputs</th>}
            <th scope="col">Outputs</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rowCap.visible.map((building, i) => (
            // id is unique within one response; never persisted (stability unverified).
            <BuildingRow
              key={building.id}
              building={building}
              showInputs={showInputs}
              focusRef={rowCap.expanded && i === FACTORY_ROW_CAP ? rowCap.firstRevealedRef : undefined}
            />
          ))}
        </tbody>
      </table>
      <ShowAllRows rowCap={rowCap} noun="machines" />
    </>
  );
}

interface SectionsState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  filtering: boolean;
  showInputs: boolean;
  resetKey: string;
}

/** A group's disclosure key: apart from a factory's (a node key and a factory key are different kinds of server string). */
const groupKeyOf = (key: string) => `group\u0001${key}`;

/**
 * ADR-0062 F.2: the machines by Planner factory (parents, then their parts), then by group, each a disclosure with its
 * counts; the groups no factory claims and "Other machines" after them. `grouping` is what the filter and search left;
 * `whole` is before them, for each factory's starting state (over 20 groups starts closed, like the outline). While
 * filtering, every section starts open, so a search shows its hits; a section the viewer closed stays closed.
 */
function MachineSections({
  grouping,
  whole,
  filtering,
  showInputs,
  resetKey,
}: {
  grouping: MachineGrouping;
  whole: MachineGrouping;
  filtering: boolean;
  showInputs: boolean;
  resetKey: string;
}) {
  const closedAtFirst = useMemo(() => {
    const keys = new Set<string>();
    const walk = (f: MachineFactory) => {
      if (!startsOpen(f)) keys.add(f.key);
      f.parts.forEach(walk);
    };
    whole.factories.forEach(walk);
    return keys;
  }, [whole]);
  const defaultOf = useCallback((key: string) => filtering || !closedAtFirst.has(key), [filtering, closedAtFirst]);
  const { isOpen, toggle } = useDisclosures(defaultOf);
  const state: SectionsState = { isOpen, toggle, filtering, showInputs, resetKey };
  return (
    <ul data-machine-groups="" aria-label="Machines by factory" className="m-0 grid list-none gap-4 p-0">
      {grouping.factories.map((f) => (
        <FactorySection key={f.key} factory={f} level={4} state={state} />
      ))}
      {grouping.groups.map((g) => (
        <GroupSection key={g.key} group={g} level={4} state={state} />
      ))}
      {grouping.other.length > 0 && (
        <OtherSection rows={grouping.other} total={whole.otherTotal} level={4} state={state} />
      )}
    </ul>
  );
}

/**
 * " · 24 machines · 2 backed up", or " · 3 of 24 machines" while filtering: read with the heading, outside its button.
 * `counted`: the title already counts them ("8× Constructor, ..."), so only a filter's "3 of 8" is added.
 */
function Counts({ shown, total, backedUp, filtering, counted = false }: { shown: number; total: number; backedUp: number; filtering: boolean; counted?: boolean }) {
  const narrowed = filtering && shown < total;
  const count = narrowed ? `${shown} of ${machines(total)}` : counted ? null : machines(total);
  if (count === null && backedUp === 0) return null;
  return (
    <span className="text-xs font-normal normal-case tracking-normal text-muted">
      {count !== null && ` · ${count}`}
      {backedUp > 0 && ` · ${backedUp} backed up`}
    </span>
  );
}

function FactorySection({ factory, level, state }: { factory: MachineFactory; level: number; state: SectionsState }) {
  const ids = useId();
  const open = state.isOpen(factory.key);
  return (
    // A rule above each factory sets it apart from its groups, whose headings are nearly its size (`ui-reviewer`).
    <li className="grid gap-3 border-t border-line pt-3" data-machine-factory="">
      <DisclosureHeading
        level={level}
        open={open}
        onToggle={() => state.toggle(factory.key)}
        controls={`${ids}-body`}
        after={<Counts shown={factory.machineCount} total={factory.total} backedUp={backedUpIn(factory)} filtering={state.filtering} />}
      >
        {factory.name}
      </DisclosureHeading>
      <div id={`${ids}-body`} hidden={!open}>
        {open && (
          <ul aria-label={`${factory.parts.length > 0 ? "Parts" : "Groups"} of ${factory.name}`} className="m-0 grid list-none gap-4 p-0 sm:ps-4">
            {factory.parts.map((p) => (
              <FactorySection key={p.key} factory={p} level={level + 1} state={state} />
            ))}
            {factory.groups.map((g) => (
              <GroupSection key={g.key} group={g} level={level + 1} state={state} />
            ))}
          </ul>
        )}
      </div>
      {!open && <p className="m-0 text-sm text-muted">{factory.groupCount} {factory.groupCount === 1 ? "group" : "groups"}, folded</p>}
    </li>
  );
}

function GroupSection({ group, level, state }: { group: MachineGroup; level: number; state: SectionsState }) {
  return <ListSection sectionKey={groupKeyOf(group.key)} title={group.label} counted rows={group.buildings} total={group.total} level={level} state={state} />;
}

/** Machines no group names: the graph is older than the factory read, or its caps left them out. */
function OtherSection({ rows, total, level, state }: { rows: readonly FactoryBuilding[]; total: number; level: number; state: SectionsState }) {
  return <ListSection sectionKey={OTHER_MACHINES_KEY} title="Other machines" rows={rows} total={total} level={level} state={state} />;
}

function ListSection({
  sectionKey,
  title,
  counted = false,
  rows,
  total,
  level,
  state,
}: {
  sectionKey: string;
  title: string;
  counted?: boolean;
  rows: readonly FactoryBuilding[];
  total: number;
  level: number;
  state: SectionsState;
}) {
  const ids = useId();
  const open = state.isOpen(sectionKey);
  return (
    <li className="grid gap-3" data-machine-group="">
      <DisclosureHeading
        level={level}
        open={open}
        onToggle={() => state.toggle(sectionKey)}
        controls={`${ids}-body`}
        id={`${ids}-heading`}
        after={<Counts shown={rows.length} total={total} backedUp={rows.filter(isBackedUpState).length} filtering={state.filtering} counted={counted} />}
      >
        {title}
      </DisclosureHeading>
      <div id={`${ids}-body`} hidden={!open} className="grid gap-3">
        {open && <MachineTable rows={rows} showInputs={state.showInputs} resetKey={state.resetKey} labelledBy={`${ids}-heading`} />}
      </div>
    </li>
  );
}

/**
 * `focusRef`: on the first row "Show all" revealed, whose name takes focus (focusable from script only, never a tab stop),
 * so the reader carries on at the row after the one they stopped at.
 */
function BuildingRow({
  building,
  showInputs,
  focusRef,
}: {
  building: FactoryBuilding;
  showInputs: boolean;
  focusRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <tr>
      <th scope="row" ref={focusRef} tabIndex={focusRef ? -1 : undefined}>
        {building.name}
      </th>
      <td>
        {building.recipe ?? "No recipe"}
        <Clock percent={building.clockSpeedPercent} />
      </td>
      {showInputs && (
        <td>
          {/* Absent (an older backend, ADR-0007) says nothing; [] is a machine with no recipe. */}
          {building.ingredients && <Rates rates={building.ingredients} label="Inputs" />}
        </td>
      )}
      <td>
        <Rates rates={building.production} label="Outputs" />
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

/** A machine's inputs or outputs, one plain line each. */
function Rates({ rates, label }: { rates: ProductionRate[]; label: "Inputs" | "Outputs" }) {
  // Stacked on a phone, two bare dashes under "No recipe" say nothing more: the table shows them.
  if (rates.length === 0) return <span className="max-table-rows:hidden">—</span>;
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
            {`${rate.name}: `}
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

/**
 * The backend's state as a label, plus any flag the state doesn't already say. From an older
 * backend without `state`, or with one this frontend doesn't know, just the flags. A state the
 * Planner marks (ADR-0062 F.3) wears the same `StateMark` before its word, in the same tone;
 * the word stays, so the mark only repeats it (it is `aria-hidden`).
 */
function StateTags({ building }: { building: FactoryBuilding }) {
  const tags = [
    building.state,
    building.isBackedUp && building.state !== "backedUp" ? "backedUp" : undefined,
    building.isPaused && building.state !== "paused" ? "paused" : undefined,
  ].flatMap((state) => {
    const view = machineState(state);
    return state === undefined || view === null ? [] : [{ state, view }];
  });
  return tags.map(({ state, view }, i) => (
    <Fragment key={view.label}>
      {i > 0 && " "}
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium", view.tone)}>
        {isStalledKind(state) && <StateMark kind={state} />}
        {view.label}
      </span>
    </Fragment>
  ));
}

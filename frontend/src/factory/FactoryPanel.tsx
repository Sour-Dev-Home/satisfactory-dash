import { Fragment, useState } from "react";
import type { FactoryBuilding, FactoryResponse, ProductionRate } from "@satisfactory-dash/shared";
import { formatPercent, formatRate, formatTime } from "../format";
import { POLL_MS } from "../api/queries";
import { DataAge } from "../components/DataAge";
import { cn } from "../lib/cn";
import { machineState } from "./machineState";

type Filter = "all" | "backedUp" | "paused" | "noRecipe";

const FILTERS: { id: Filter; label: string; match: (b: FactoryBuilding) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "backedUp", label: "Backed up", match: (b) => b.isBackedUp },
  { id: "paused", label: "Paused", match: (b) => b.isPaused },
  { id: "noRecipe", label: "No recipe", match: (b) => b.recipe === null },
];

/**
 * Presentational: one factory snapshot, with in-memory filter and search. Backed-up is
 * information, not an alarm: on a real save a large share of machines is backed up in
 * normal steady-state play, so it's a count and a filter, never a red banner.
 */
export function FactoryPanel({ snapshot }: { snapshot: FactoryResponse }) {
  const { buildings, backedUpCount } = snapshot.data;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const needle = search.trim().toLowerCase();
  const shown = buildings.filter(
    (b) =>
      active.match(b) &&
      (!needle || b.name.toLowerCase().includes(needle) || (b.recipe ?? "").toLowerCase().includes(needle)),
  );
  const paused = buildings.filter((b) => b.isPaused).length;
  const noRecipe = buildings.filter((b) => b.recipe === null).length;
  // An older backend sends no ingredients at all: no Inputs column rather than an empty one.
  const showInputs = buildings.some((b) => b.ingredients !== undefined);

  return (
    <section aria-labelledby="factory-heading" className="panel">
      <h3 id="factory-heading">Factory</h3>
      {snapshot.stale && <p>Showing last known factory data from {formatTime(snapshot.observedAt)}.</p>}

      {buildings.length === 0 ? (
        <p>No machines yet.</p>
      ) : (
        <>
          <p className="summary">
            {buildings.length} {buildings.length === 1 ? "machine" : "machines"} · {backedUpCount} backed up · {paused} paused · {noRecipe} without a recipe
          </p>
          <div role="group" aria-label="Filter machines">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            Search machines
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>

          {shown.length === 0 ? (
            <p>No machines match.</p>
          ) : (
            <table>
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
                {shown.map((building) => (
                  // id is unique within one response; never persisted (stability unverified).
                  <BuildingRow key={building.id} building={building} showInputs={showInputs} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p className="as-of">
        <DataAge observedAt={snapshot.observedAt} pollMs={POLL_MS.factory} />
      </p>
    </section>
  );
}

function BuildingRow({ building, showInputs }: { building: FactoryBuilding; showInputs: boolean }) {
  return (
    <tr>
      <th scope="row">{building.name}</th>
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
  if (rates.length === 0) return <span className="max-[600px]:hidden">—</span>;
  return (
    <>
      {/* On a phone the table stacks and its header row is hidden: name the list there. */}
      <span aria-hidden="true" className="block text-xs text-muted min-[601px]:hidden">
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
 * backend without `state`, or with one this frontend doesn't know, just the flags.
 */
function StateTags({ building }: { building: FactoryBuilding }) {
  const tags = [
    machineState(building.state),
    building.isBackedUp && building.state !== "backedUp" ? machineState("backedUp") : null,
    building.isPaused && building.state !== "paused" ? machineState("paused") : null,
  ].filter((tag) => tag !== null);
  return tags.map((tag, i) => (
    <Fragment key={tag.label}>
      {i > 0 && " "}
      <span className={cn("whitespace-nowrap text-sm font-medium", tag.tone)}>{tag.label}</span>
    </Fragment>
  ));
}

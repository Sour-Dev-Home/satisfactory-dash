import { useState } from "react";
import type { FactoryBuilding, FactoryResponse } from "@satisfactory-dash/shared";
import { formatPercent, formatRate, formatTime } from "../format";

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

  return (
    <section aria-labelledby="factory-heading" className="panel">
      <h3 id="factory-heading">Factory</h3>
      {snapshot.stale && <p>Showing last known factory data from {formatTime(snapshot.observedAt)}.</p>}

      {buildings.length === 0 ? (
        <p>No machines yet.</p>
      ) : (
        <>
          <p className="summary">
            {buildings.length} machines · {backedUpCount} backed up · {paused} paused · {noRecipe} without a recipe
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
                  <th scope="col">Outputs</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((building) => (
                  // id is unique within one response; never persisted (stability unverified).
                  <BuildingRow key={building.id} building={building} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p className="as-of">
        As of <time dateTime={snapshot.observedAt}>{formatTime(snapshot.observedAt)}</time>
      </p>
    </section>
  );
}

function BuildingRow({ building }: { building: FactoryBuilding }) {
  return (
    <tr>
      <th scope="row">{building.name}</th>
      <td>{building.recipe ?? "No recipe"}</td>
      <td>
        {building.production.length === 0 ? (
          "—"
        ) : (
          <ul>
            {/* Activity is the averaged percent, never the instantaneous isProducing flag. */}
            {/* Index in the key: nothing in the contract says output class names are unique. */}
            {building.production.map((rate, i) => (
              <li key={`${i}-${rate.className}`}>
                {/* unit is optional (ADR-0015): missing or null = unknown, shown as "per min". */}
                {`${rate.name}: ${formatRate(rate.currentPerMinute, rate.maxPerMinute, rate.unit ?? null)}`}{" "}
                ({formatPercent(rate.percent)})
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {building.isBackedUp && <span className="tag">Backed up</span>}{" "}
        {building.isPaused && <span className="tag">Paused</span>}
      </td>
    </tr>
  );
}

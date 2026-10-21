import type { ReactNode } from "react";
import {
  BUILDING_FILTER_KEYS,
  buildingFilterLabel,
  hiddenSummary,
  toggled,
  type BuildingFilterKey,
  type MapFilters,
  type TypeEntry,
  type UseFilter,
} from "./mapFilters";
import { resourceIconUrl } from "./resourceIcons";

const USE_OPTIONS: { value: UseFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "free", label: "Free only" },
  { value: "used", label: "In use only" },
];

function AllNone({ onAll, onNone, label }: { onAll: () => void; onNone: () => void; label: string }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onAll} aria-label={`Show all ${label}`}>
        All
      </button>
      <button type="button" onClick={onNone} aria-label={`Hide all ${label}`}>
        None
      </button>
    </div>
  );
}

function Group({ legend, actions, children }: { legend: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 font-medium text-fg">{legend}</legend>
      {actions}
      {children}
    </fieldset>
  );
}

/**
 * The map's filters, in a closed `<details>` so they don't push the map down a phone's screen. A group
 * shows only while its layer is on; the resource types are the ones present in the data, with counts.
 */
export function MapFilterPanel({
  filters,
  onChange,
  types,
  buildingCounts,
}: {
  filters: MapFilters;
  onChange: (update: (current: MapFilters) => MapFilters) => void;
  /** The resource types present, or null while the resource layer is off. */
  types: readonly TypeEntry[] | null;
  /** Buildings per filter class, or null while the buildings layer is off. */
  buildingCounts: ReadonlyMap<BuildingFilterKey, number> | null;
}) {
  if (!types && !buildingCounts) return null;
  const set = (patch: Partial<MapFilters>) => onChange((current) => ({ ...current, ...patch }));
  return (
    <details
      open={filters.open}
      onToggle={(e) => {
        const open = e.currentTarget.open;
        if (open !== filters.open) set({ open });
      }}
      className="group grid gap-3 text-sm"
    >
      <summary className="flex min-h-touch cursor-pointer items-center gap-2 text-fg">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="disclosure-chevron size-4 flex-none group-open:rotate-90">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="font-medium">Filters</span>
        <span className="text-muted">({hiddenSummary(filters, types, buildingCounts)})</span>
      </summary>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {types && (
          <>
            {types.length > 0 && (
              <Group
                legend="Resource types"
                actions={
                  <AllNone
                    label="resource types"
                    onAll={() => set({ hiddenTypes: new Set() })}
                    onNone={() => set({ hiddenTypes: new Set(types.map((t) => t.key)) })}
                  />
                }
              >
                <div className="flex flex-wrap gap-x-6">
                  {types.map(({ key, count, sample }) => {
                    const icon = resourceIconUrl(sample.type, sample.nodeType);
                    return (
                      <label key={key} className="flex min-h-touch items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!filters.hiddenTypes.has(key)}
                          onChange={() => set({ hiddenTypes: toggled(filters.hiddenTypes, key) })}
                        />
                        {icon && <img src={icon} alt="" className="size-6 flex-none" />}
                        {key}
                        <span className="text-muted">({count})</span>
                      </label>
                    );
                  })}
                </div>
              </Group>
            )}
            <Group legend="Resource nodes in use or free">
              <div className="flex flex-wrap gap-x-6">
                {USE_OPTIONS.map(({ value, label }) => (
                  <label key={value} className="flex min-h-touch items-center gap-2">
                    <input type="radio" name="map-node-use" checked={filters.use === value} onChange={() => set({ use: value })} />
                    {label}
                  </label>
                ))}
              </div>
            </Group>
          </>
        )}
        {buildingCounts && (
          <Group
            legend="Building states"
            actions={
              <AllNone
                label="building states"
                onAll={() => set({ hiddenStates: new Set() })}
                onNone={() => set({ hiddenStates: new Set(BUILDING_FILTER_KEYS) })}
              />
            }
          >
            <div className="flex flex-wrap gap-x-6">
              {BUILDING_FILTER_KEYS.map((key) => (
                <label key={key} className="flex min-h-touch items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!filters.hiddenStates.has(key)}
                    onChange={() => set({ hiddenStates: toggled(filters.hiddenStates, key) })}
                  />
                  {buildingFilterLabel(key)}
                  <span className="text-muted">({buildingCounts.get(key) ?? 0})</span>
                </label>
              ))}
            </div>
          </Group>
        )}
      </div>
    </details>
  );
}

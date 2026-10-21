import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HistoryRange } from "@satisfactory-dash/shared";
import { keepForServer, queries } from "../api/queries";
import { cn } from "../lib/cn";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable } from "../ui/Skeleton";
import { PowerHistorySkeleton } from "./PowerHistorySkeleton";
import { PowerHistoryView } from "./PowerHistoryView";
import { RANGE_LABEL, rangeLabel, rangeWords, type PowerRange } from "./storedHistory";
import { StoredPowerHistoryPanel } from "./StoredPowerHistoryPanel";

const RANGES = Object.keys(RANGE_LABEL) as PowerRange[];

/** Container for one stored range (ADR-0027): its own load and error states. */
function StoredPowerHistoryView({ range }: { range: HistoryRange }) {
  const server = useSelectedServer();
  const history = useQuery({ ...queries.historyPower(server.id, range), placeholderData: keepForServer(server.id) });
  if (!history.data && !history.isPending) {
    return (
      <ErrorNotice
        error={history.error}
        action={
          <button type="button" onClick={() => void history.refetch()}>
            Retry
          </button>
        }
      />
    );
  }
  return (
    <Loadable pending={history.isPending} skeleton={<PowerHistorySkeleton />} className="grid gap-3">
      {history.isError && <ErrorNotice error={history.error} />}
      {history.data && (
        // Keyed by the range the data is for: the last range stays up, dimmed, until the new one lands.
        <div key={history.data.data.range} aria-busy={history.isPlaceholderData} className={cn(history.isPlaceholderData && "placeholder-dim")}>
          <StoredPowerHistoryPanel history={history.data.data} />
        </div>
      )}
    </Loadable>
  );
}

/**
 * The Power page's history (the owner's #74): the live 5-minute chart by default (ADR-0022), or a
 * stored range from the database (ADR-0027). The choice is per visit, never stored.
 */
export function PowerHistorySection() {
  const [range, setRange] = useState<PowerRange>("live");
  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Power history range" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            // The visible label is the accessible name (WCAG 2.5.3); the title spells it out.
            title={r === "live" ? "Live, last 5 minutes" : rangeWords(r)}
            onClick={() => setRange(r)}
            className="min-w-touch"
          >
            {rangeLabel(r)}
          </button>
        ))}
      </div>
      {range === "live" ? <PowerHistoryView /> : <StoredPowerHistoryView range={range} />}
    </div>
  );
}

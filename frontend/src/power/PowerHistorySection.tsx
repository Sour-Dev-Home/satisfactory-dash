import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HistoryRange } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { PowerHistoryView } from "./PowerHistoryView";
import { RANGE_LABEL, RANGE_WORDS, type PowerRange } from "./storedHistory";
import { StoredPowerHistoryPanel } from "./StoredPowerHistoryPanel";

const RANGES = Object.keys(RANGE_LABEL) as PowerRange[];

/** Container for one stored range (ADR-0027): its own load and error states. */
function StoredPowerHistoryView({ range }: { range: HistoryRange }) {
  const server = useSelectedServer();
  const history = useQuery(queries.historyPower(server.id, range));
  if (history.isPending) return <p role="status">Loading power history…</p>;
  if (!history.data) {
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
    <>
      {history.isError && <ErrorNotice error={history.error} />}
      <StoredPowerHistoryPanel history={history.data.data} />
    </>
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
            title={r === "live" ? "Live, last 5 minutes" : RANGE_WORDS[r]}
            onClick={() => setRange(r)}
            className="min-w-[44px]"
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>
      {range === "live" ? <PowerHistoryView /> : <StoredPowerHistoryView key={range} range={range} />}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HistoryRange } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { cn } from "../lib/cn";
import { useSelectedServer } from "../servers/ServerContext";
import type { ItemLabel } from "./itemLabels";
import { ItemHistoryPanel } from "./ItemHistoryPanel";
import { RANGE_LABEL, RANGE_WORDS, RANGES } from "./itemHistory";
import { SinceYesterdayPanel } from "./SinceYesterdayPanel";

/** The most transitions the backend sends in one answer; more reads "500+". */
const TRANSITION_LIMIT = 500;

/** The two queries "Since yesterday" reads; FactoryView gives them a short grace (ADR-0032). */
export function sinceYesterdayQueries(serverId: string) {
  return {
    history: queries.historyItems(serverId, "7d"),
    transitions: queries.historyTransitions(serverId, "24h", TRANSITION_LIMIT),
  };
}

/** The box "Since yesterday" reserves in every state, so nothing it shows moves the table below. */
const SINCE_YESTERDAY_BOX = "h-since-yesterday-phone sm:h-since-yesterday-mid lg:h-since-yesterday-wide";

/**
 * Container for "Since yesterday" (ADR-0027 item 6): the 7d range's hourly buckets, and the last
 * 24 h of state changes. The comparison shows even if the transitions can't load. Loading, error
 * and content all fill the same reserved box.
 */
export function SinceYesterdayView({ labels }: { labels: Map<string, ItemLabel> }) {
  const server = useSelectedServer();
  const since = sinceYesterdayQueries(server.id);
  const history = useQuery(since.history);
  const transitions = useQuery(since.transitions);
  if (history.isPending) {
    return (
      <p role="status" className={cn("panel place-content-center text-muted", SINCE_YESTERDAY_BOX)}>
        Loading what changed since yesterday…
      </p>
    );
  }
  if (!history.data) {
    return (
      <div className={cn("grid content-start overflow-y-auto", SINCE_YESTERDAY_BOX)}>
        <ErrorNotice
          error={history.error}
          action={
            <button type="button" onClick={() => void history.refetch()}>
              Retry
            </button>
          }
        />
      </div>
    );
  }
  return (
    <SinceYesterdayPanel
      history={history.data.data}
      transitions={transitions.data?.data}
      labels={labels}
      className={SINCE_YESTERDAY_BOX}
    />
  );
}

/** One stored range of item history: its own load and error states. */
function ItemHistoryRange({
  range,
  labels,
  item,
  onItem,
}: {
  range: HistoryRange;
  labels: Map<string, ItemLabel>;
  item: string | undefined;
  onItem: (item: string) => void;
}) {
  const server = useSelectedServer();
  const history = useQuery(queries.historyItems(server.id, range));
  if (history.isPending) return <p role="status">Loading production history…</p>;
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
      <ItemHistoryPanel history={history.data.data} labels={labels} item={item} onItem={onItem} />
    </>
  );
}

/**
 * The Factory page's production history (ADR-0027 decision 3): a range picker like the Power
 * page's, then one item's chart. The range and item are per visit, never stored.
 */
export function ItemHistorySection({ labels }: { labels: Map<string, ItemLabel> }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [item, setItem] = useState<string>();
  return (
    <section aria-labelledby="production-history-heading" className="panel grid gap-3">
      <h3 id="production-history-heading">Production history</h3>
      <div role="group" aria-label="Production history range" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            // The visible label is the accessible name (WCAG 2.5.3); the title spells it out.
            title={RANGE_WORDS[r]}
            onClick={() => setRange(r)}
            className="min-w-touch"
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>
      <ItemHistoryRange key={range} range={range} labels={labels} item={item} onItem={setItem} />
    </section>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HistoryRange } from "@satisfactory-dash/shared";
import { keepForServer, queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { cn } from "../lib/cn";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { HISTORY_ANCHOR } from "../lib/deepLinks";
import { useHashTarget } from "../lib/useHashTarget";
import { useSelectedServer } from "../servers/ServerContext";
import type { ItemLabel } from "./itemLabels";
import { ItemHistoryPanel } from "./ItemHistoryPanel";
import { RANGES, rangeLabel, rangeWords } from "./itemHistory";
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

const isHistoryAnchor = (id: string) => id === HISTORY_ANCHOR;

/** The box "Since yesterday" reserves in every state, so nothing it shows moves the table below. */
export const SINCE_YESTERDAY_BOX = "h-since-yesterday-phone sm:h-since-yesterday-mid lg:h-since-yesterday-wide";

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
  return (
    <Loadable pending={history.isPending} skeleton={<SinceYesterdaySkeleton />} className={SINCE_YESTERDAY_BOX}>
      {history.data ? (
        <SinceYesterdayPanel
          history={history.data.data}
          transitions={transitions.data?.data}
          labels={labels}
          className={SINCE_YESTERDAY_BOX}
        />
      ) : (
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
      )}
    </Loadable>
  );
}

/** "Since yesterday" while it loads: a panel in the reserved box, a heading bar over one big block. */
export function SinceYesterdaySkeleton() {
  return (
    <section aria-busy="true" className={cn("panel", SINCE_YESTERDAY_BOX)}>
      <SkeletonStatus>Loading what changed since yesterday…</SkeletonStatus>
      <Skeleton className="h-lh w-40 text-xl" />
      <Skeleton className="h-lh w-full max-w-xl" />
      <Skeleton className="h-lh w-full max-w-64 text-sm" />
    </section>
  );
}

/**
 * Production history while it loads, in the loaded panel's shape: the picker row, a line of stats,
 * the chart's slot, its note and the readings table's summary. It sits below the table, so a
 * one-line status growing into the panel would push the footer (ADR-0032's tab-switch budget). The
 * `invisible` lines hold the height their text will take without showing anything.
 */
function ItemHistorySkeleton() {
  return (
    <div className="grid gap-3">
      <SkeletonStatus>Loading production history…</SkeletonStatus>
      <Skeleton className="h-touch" />
      <p className="invisible">Loading</p>
      <Skeleton className="h-chart-slot-phone sm:h-chart-slot" />
      <p className="invisible text-sm">
        A break in the line means nothing was recorded then (the game was paused or the server couldn't be reached).
      </p>
      <p className="invisible text-sm">Readings table</p>
    </div>
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
  const history = useQuery({ ...queries.historyItems(server.id, range), placeholderData: keepForServer(server.id) });
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
    <Loadable pending={history.isPending} skeleton={<ItemHistorySkeleton />}>
      {history.isError && <ErrorNotice error={history.error} />}
      {history.data && (
        // Keyed by the range the data is for: the last range stays up, dimmed, until the new one lands.
        <div key={history.data.data.range} aria-busy={history.isPlaceholderData} className={cn(history.isPlaceholderData && "placeholder-dim")}>
          <ItemHistoryPanel history={history.data.data} labels={labels} item={item} onItem={onItem} />
        </div>
      )}
    </Loadable>
  );
}

/**
 * The Factory page's production history (ADR-0027 decision 3): a range picker like the Power
 * page's, then one item's chart. The range and item are per visit, never stored. `item`/`onItem`:
 * the view keeps the item in the URL (?item=, #351); without them it's local. /app/factory#history
 * scrolls here.
 */
export function ItemHistorySection({
  labels,
  item: itemProp,
  onItem,
}: {
  labels: Map<string, ItemLabel>;
  item?: string;
  onItem?: (item: string) => void;
}) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [localItem, setLocalItem] = useState<string>();
  const item = itemProp ?? localItem;
  const setItem = onItem ?? setLocalItem;
  useHashTarget(isHistoryAnchor);
  return (
    <section id={HISTORY_ANCHOR} aria-labelledby="production-history-heading" className="panel grid gap-3">
      <h3 id="production-history-heading">Production history</h3>
      <div role="group" aria-label="Production history range" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            // The visible label is the accessible name (WCAG 2.5.3); the title spells it out.
            title={rangeWords(r)}
            onClick={() => setRange(r)}
            className="min-w-touch"
          >
            {rangeLabel(r)}
          </button>
        ))}
      </div>
      <ItemHistoryRange range={range} labels={labels} item={item} onItem={setItem} />
    </section>
  );
}

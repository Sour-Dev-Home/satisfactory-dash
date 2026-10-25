import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { METRICS_WINDOWS, type MetricsWindow } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";
import { isFirstLoad } from "../api/settled";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { IS_DEMO } from "../demo/mode";
import { retryText } from "../selfServe/selfServeText";
import { ToApp } from "../shell/ToApp";
import { Loadable, PanelSkeleton, SkeletonStatus } from "../ui/Skeleton";
import { formatTime } from "../format";
import { MetricsSections } from "./MetricsSections";
import { DEFAULT_METRICS_WINDOW, WINDOW_LABEL, windowWords } from "./metricsText";

/** The page while it loads: a panel per section, tall enough that the data doesn't push anything down. */
function MetricsSkeleton() {
  return (
    <div className="grid gap-4">
      <SkeletonStatus>Loading metrics…</SkeletonStatus>
      <PanelSkeleton label="Loading system metrics" rows={5} rowClass="h-24" />
      <PanelSkeleton label="Loading alert quality" rows={3} />
      <PanelSkeleton label="Loading delivery figures" rows={4} />
    </div>
  );
}

/** A 429 is a polite "not so fast", not a fault: a calm line with the wait and a way to try again. */
function isRateLimited(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 429 || error.code === "rate_limited");
}

/**
 * ADR-0056 section 3: the operator's metrics page, `/app/metrics`. Out of the nav in the real app (the command bar and
 * the Servers page link to it); the shell only routes it for the operator, and a 403 from the backend sends anyone else
 * to the same redirect as an unknown page. A 401 is handled centrally (`createQueryClient`), never here.
 */
export function MetricsView() {
  const [range, setRange] = useState<MetricsWindow>(DEFAULT_METRICS_WINDOW);
  const metrics = useQuery(queries.metrics(range));

  if (metrics.error instanceof ApiError && metrics.error.status === 403) return <ToApp />;

  const overview = metrics.data;
  const switching = metrics.isPlaceholderData;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Metrics window" className="flex flex-wrap gap-2">
          {METRICS_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={w === range}
              title={`Show ${windowWords(w)}`}
              onClick={() => setRange(w)}
              className="min-w-touch"
            >
              {WINDOW_LABEL.get(w)?.short ?? w}
            </button>
          ))}
        </div>
        <button type="button" disabled={metrics.isFetching} onClick={() => void metrics.refetch()}>
          Refresh
        </button>
      </div>
      {IS_DEMO && (
        <p className="mb-0 rounded-card border border-line bg-surface p-3 text-sm text-muted">
          Sample data: made-up numbers for this demo. The real page is visible only to the site's operator.
        </p>
      )}
      <p role="status" className="mb-0 min-h-lh text-sm text-muted">
        {overview ? (switching ? `Loading ${windowWords(range)}…` : `Showing ${windowWords(overview.window)}, computed ${formatTime(overview.generatedAt)}.`) : ""}
      </p>
      {metrics.isError &&
        (isRateLimited(metrics.error) ? (
          <div role="status" data-rate-limited="" className="grid justify-items-start gap-2 rounded-card border border-line bg-surface p-4">
            <p className="mb-0">Metrics were asked for too often. Try again {retryText(metrics.error.retryAfterSeconds)}.</p>
            <button type="button" onClick={() => void metrics.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <ErrorNotice
            error={metrics.error}
            action={
              <button type="button" onClick={() => void metrics.refetch()}>
                Retry
              </button>
            }
          />
        ))}
      {overview ? (
        <div aria-busy={switching} className="grid gap-4">
          <MetricsSections overview={overview} />
        </div>
      ) : (
        !metrics.isError && (
          <Loadable pending={isFirstLoad(metrics)} skeleton={<MetricsSkeleton />}>
            {null}
          </Loadable>
        )
      )}
    </div>
  );
}

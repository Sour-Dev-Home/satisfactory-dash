import type { Bottlenecks } from "@satisfactory-dash/shared";
import type { ComponentProps, ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { PanelError } from "../components/PanelError";
import { cn } from "../lib/cn";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { bottleneckSummaryCount, machineLabel, stateLabel } from "./bottlenecks";
import { BOTTLENECK_SUMMARY_CAP, BOTTLENECKS_ANCHOR, useBottlenecks } from "./bottlenecksRead";

/**
 * One summary line: a line of small text and a hair of padding, the same in every state (a cause, the calm line, a
 * skeleton bar, an empty pad), and cut with an ellipsis rather than wrapped, so the box's height never depends on what it says.
 */
const ROW = "min-h-lh truncate py-0.5 text-sm";

/** Empty lines that pad the summary to the cap, so one cause stands as tall as three. Decorative. */
function Pad({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <div key={i} aria-hidden="true" className={ROW} />);
}

/**
 * The box every state shares: a touch-tall head row, then exactly `BOTTLENECK_SUMMARY_CAP` lines. Its height is fixed by
 * that structure, not by the data: the bottlenecks read is not one the page's reveal waits for (shell/pageQueries.ts), so
 * it often lands after the table is on screen, and the summary sits above the table (ADR-0032's shift budget).
 */
function Frame({ head, children, ...props }: { head: ReactNode; children: ReactNode } & ComponentProps<"section">) {
  return (
    // min-w-0 and one 0-min column at every grid level: a line that never wraps would otherwise size its track to the
    // whole text and push the page wider than a phone, instead of being cut by `truncate`.
    <section {...props} className="panel min-w-0 grid-cols-1 content-start">
      <div className="flex min-h-touch min-w-0 items-center justify-between gap-3">{head}</div>
      <div className="grid min-w-0 grid-cols-1">{children}</div>
    </section>
  );
}

/**
 * ADR-0062 F.1: the bottlenecks first. A count, the most severe causes in the backend's own rank order (the most output
 * lost first, ADR-0048), state word first so a cut line still says it, and a link down to the full list.
 */
export function BottleneckSummary({ data }: { data: Bottlenecks }) {
  const location = useLocation();
  const top = data.findings.slice(0, BOTTLENECK_SUMMARY_CAP);
  const head = (
    <>
      <h3 className="m-0 min-w-0 truncate">
        {bottleneckSummaryCount(data)}
      </h3>
      {top.length > 0 && (
        // The name starts with the visible words (WCAG 2.5.3) and says which list.
        <Link
          to={{ search: location.search, hash: `#${BOTTLENECKS_ANCHOR}` }}
          // Always a push: on the same URL react-router would replace, keep the history index and so the page's
          // once-per-navigation jump (useHashTarget) would not fire again after the reader scrolled away.
          replace={false}
          aria-label="Full list of bottlenecks"
          className="inline-flex min-h-touch shrink-0 items-center"
        >
          Full list
        </Link>
      )}
    </>
  );
  return (
    // A fixed region name: the heading's count changes with every poll.
    <Frame aria-label="Bottleneck summary" data-bottleneck-summary="" head={head}>
      {top.length === 0 ? (
        <p className={cn(ROW, "m-0 text-muted")}>All machines are fed and flowing.</p>
      ) : (
        // Tailwind's reset drops the markers, and Safari then drops the list role: say it.
        <ol role="list" aria-label="Worst bottlenecks" className="grid min-w-0 grid-cols-1">
          {top.map((f) => (
            // One line, the same height as ROW: only the machine's name is cut, so the state and the count always show.
            // The spaces between the parts are for the text (copy, screen readers); the gap does the spacing on screen.
            <li key={f.buildingId} className="flex min-h-lh min-w-0 gap-1 whitespace-nowrap py-0.5 text-sm">
              {/* Underfed in the info colour and backed up in amber, as in the full list (#586). */}
              <span className={cn("shrink-0", f.state === "underfed" ? "text-info" : "text-warn")}>{stateLabel(f.state)} ·</span>{" "}
              <span data-machine="" className="min-w-0 truncate text-fg">{machineLabel(f)}</span>
              {(f.affectedCount ?? 1) > 1 && (
                <>
                  {" "}
                  <span className="shrink-0 text-muted">· {f.affectedCount} machines</span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <Pad count={BOTTLENECK_SUMMARY_CAP - Math.max(top.length, 1)} />
    </Frame>
  );
}

/** The summary while it loads: the same box, a bar where the count is and one per line. */
export function BottleneckSummarySkeleton() {
  return (
    <Frame aria-busy="true" head={<Skeleton className="h-lh w-32" />}>
      <SkeletonStatus>Loading the bottleneck summary…</SkeletonStatus>
      {Array.from({ length: BOTTLENECK_SUMMARY_CAP }, (_, i) => (
        <div key={i} aria-hidden="true" className={ROW}>
          <Skeleton className="h-lh w-full max-w-md" />
        </div>
      ))}
    </Frame>
  );
}

/**
 * A failed read: the panel's usual error (PanelError) laid over an unseen copy of the box, so the place keeps at least
 * the summary's height and the table below doesn't move up when the read fails, or back down when it recovers.
 */
function SummaryError({ error }: { error: unknown }) {
  return (
    <div className="grid grid-cols-1">
      <div aria-hidden="true" className="invisible col-start-1 row-start-1 min-w-0">
        <Frame head={null}>
          <Pad count={BOTTLENECK_SUMMARY_CAP} />
        </Frame>
      </div>
      {error != null && (
        <div className="col-start-1 row-start-1 grid min-w-0 grid-cols-1">
          {/* Its own title, so the page doesn't carry two "Bottlenecks" headings while the full list says the same. */}
          <PanelError error={error} title="Bottleneck summary" />
        </div>
      )}
    </div>
  );
}

/** Container: the summary at the top of the Factory page, from the same read as the full list (no second fetch). */
export function BottleneckSummaryView() {
  const { query, firstLoad, error } = useBottlenecks();
  return (
    <Loadable pending={firstLoad} skeleton={<BottleneckSummarySkeleton />}>
      {query.data ? <BottleneckSummary data={query.data.data} /> : <SummaryError error={error} />}
    </Loadable>
  );
}

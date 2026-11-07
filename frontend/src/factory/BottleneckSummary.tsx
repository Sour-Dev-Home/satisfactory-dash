import { BOTTLENECKS_DEFAULT_LIMIT, type Bottlenecks } from "@satisfactory-dash/shared";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router";
import { PanelError } from "../components/PanelError";
import { tour } from "../demo/tour/target";
import { cn } from "../lib/cn";
import { hashId, useHashTarget } from "../lib/useHashTarget";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { bottleneckSummaryCount, machineLabel, stateLabel, withoutSmallGaps } from "./bottlenecks";
import { BottlenecksList, hasFullList } from "./BottlenecksPanel";
import { BOTTLENECK_SUMMARY_CAP, BOTTLENECKS_ANCHOR, isBottlenecksAnchor, useBottlenecks } from "./bottlenecksRead";

/**
 * One summary line: a line of small text and a hair of padding, the same in every state (a cause, the calm line, a
 * skeleton bar, an empty pad), and cut with an ellipsis rather than wrapped, so the box's height never depends on what it says.
 */
const ROW = "min-h-lh truncate py-0.5 text-sm";

/** The card's heading: the Planner's links name it (`#bottlenecks-heading`). */
const HEADING_ID = "bottlenecks-heading";

/** Empty lines that pad the summary to the cap, so one cause stands as tall as three. Decorative. */
function Pad({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <div key={i} aria-hidden="true" className={ROW} />);
}

/**
 * The box every state shares: a touch-tall head row, then exactly `BOTTLENECK_SUMMARY_CAP` lines. Its height is fixed by
 * that structure, not by the data: the bottlenecks read is not one the page's reveal waits for (shell/pageQueries.ts), so
 * it often lands after the table is on screen, and the summary sits above the table (ADR-0032's shift budget). Only the
 * reader's own "Full list" grows it.
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

const namesList = (hash: string) => {
  const id = hashId(hash);
  return id !== undefined && isBottlenecksAnchor(id);
};

/**
 * ADR-0062 F.1 and ADR-0064: the page's one bottleneck card, first. A count, the most severe causes in the backend's own
 * rank order (the most output lost first, ADR-0048), state word first so a cut line still says it; "Full list" opens the
 * whole list in their place (`BottlenecksList`), and a link to `#bottlenecks` or `#bottlenecks-heading` (the Planner's,
 * the command bar's) opens it and jumps there. Gaps under 2% are left out everywhere (`withoutSmallGaps`).
 */
export function BottleneckSummary({ data: read }: { data: Bottlenecks }) {
  const data = withoutSmallGaps(read);
  const location = useLocation();
  const navType = useNavigationType();
  const ids = useId();
  // Open when the URL names the list, and again whenever a navigation does (a link while on the page); the reader's own
  // toggles are kept across polls.
  const [open, setOpen] = useState(() => namesList(location.hash));
  const [seenKey, setSeenKey] = useState(location.key);
  if (location.key !== seenKey) {
    setSeenKey(location.key);
    // Not a replace: the page's own (typing in the search box) carries the hash along and must not reopen a list the reader closed.
    if (navType !== "REPLACE" && namesList(location.hash)) setOpen(true);
  }
  useHashTarget(isBottlenecksAnchor);
  const top = data.findings.slice(0, BOTTLENECK_SUMMARY_CAP);
  const full = hasFullList(data);
  const head = (
    <>
      <h3 id={HEADING_ID} className="m-0 min-w-0 truncate">
        {bottleneckSummaryCount(data)}
      </h3>
      {full && (
        // The name starts with the visible words (WCAG 2.5.3) and says which list.
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          aria-label="Full list of bottlenecks"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0"
        >
          Full list
        </button>
      )}
    </>
  );
  // The closed card: the worst causes, one line each, padded to the cap.
  const summaryLines = (
    <>
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
              {/* No place here (ADR-0064): the full list has it. */}
              <span data-machine="" className="min-w-0 truncate text-fg">{machineLabel({ buildingName: f.buildingName, recipe: f.recipe })}</span>
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
    </>
  );
  return (
    // A fixed region name: the heading's count changes with every poll.
    <Frame aria-label="Bottlenecks" data-bottleneck-summary="" head={head} {...tour("factory-bottlenecks")}>
      <div id={`${ids}-body`} className="grid min-w-0 grid-cols-1">
        {open && full ? (
          // The `#bottlenecks` target: a link jumps here and focuses it (useHashTarget), so it is a group named by the heading.
          <div id={BOTTLENECKS_ANCHOR} role="group" aria-labelledby={HEADING_ID} className="grid min-w-0 scroll-mt-4 gap-3">
            <BottlenecksList data={data} limit={BOTTLENECKS_DEFAULT_LIMIT} labelledBy={HEADING_ID} />
          </div>
        ) : (
          summaryLines
        )}
      </div>
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
          <PanelError error={error} title="Bottlenecks" />
        </div>
      )}
    </div>
  );
}

/**
 * Container: the Factory page's bottleneck card (ADR-0048, #349; ADR-0064), polled with the factory. It is not one of the
 * page's primary reads (shell/pageQueries.ts), so the page never waits for it, and a failed or unsupported read (an older
 * backend's 404) shows in this card only.
 */
export function BottleneckSummaryView() {
  const { query, firstLoad, error } = useBottlenecks();
  return (
    <Loadable pending={firstLoad} skeleton={<BottleneckSummarySkeleton />}>
      {query.data ? <BottleneckSummary data={query.data.data} /> : <SummaryError error={error} />}
    </Loadable>
  );
}

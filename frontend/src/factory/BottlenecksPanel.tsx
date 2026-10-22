import type { Bottleneck, Bottlenecks } from "@satisfactory-dash/shared";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { detailLine, fixLine, isSmallGap, machineLabel, sectionNotes, stateLabel } from "./bottlenecks";

/** "Affects 61 machines", opening to the list the backend sent (its first 50) and how many more there are (#592). */
function AffectedMachines({ finding }: { finding: Bottleneck }) {
  const count = finding.affectedCount ?? 1;
  const listed = finding.affected ?? [];
  if (count < 2 || listed.length === 0) return null;
  const more = count - listed.length;
  return (
    <details className="group text-sm">
      <summary className="flex min-h-touch cursor-pointer items-center gap-2 text-fg">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="disclosure-chevron size-chevron flex-none group-open:rotate-90">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        Affects {count} machines
      </summary>
      <ul className="grid gap-0.5 pl-6 text-muted">
        {listed.map((m) => (
          <li key={m.buildingId}>{machineLabel(m)}</li>
        ))}
        {more > 0 && <li>and {more} more</li>}
      </ul>
    </details>
  );
}

/**
 * ADR-0048 (#349), Decision 4 item 5: the ranked root causes of underfed and backed-up machines, one row per cause
 * (#592). Each row names its machine (recipe and place when the backend sends them), then the backend's own sentence,
 * the capping conveyor beneath it when there is one, what would close a deficit, and the machines the cause affects.
 * The state is a word, never only a colour.
 */
export function BottlenecksPanel({ data, limit }: { data: Bottlenecks; limit: number }) {
  const notes = sectionNotes(data);
  return (
    <section aria-labelledby="bottlenecks-heading" className="panel content-start">
      <h3 id="bottlenecks-heading">Bottlenecks</h3>
      {data.findings.length === 0 ? (
        <p>No bottlenecks: no machine is underfed or backed up.</p>
      ) : (
        <ol aria-labelledby="bottlenecks-heading" className="grid gap-3">
          {data.findings.map((f, i) => (
            <li key={f.buildingId} className="flex gap-3">
              <span aria-hidden="true" className="w-6 shrink-0 text-muted tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 break-words">
                <p className="font-semibold text-fg-strong">
                  {machineLabel(f)} <span className="font-normal text-warn">· {stateLabel(f.state)}</span>
                </p>
                <p>{f.text}</p>
                {detailLine(f) !== null && <p className="text-sm text-muted">Capped by: {detailLine(f)}</p>}
                {f.fix && <p className="text-sm">Fix: {fixLine(f.fix)}</p>}
                {isSmallGap(f) && (
                  <p className="text-sm text-muted">The gap is under 2% of what is wanted, so it may be clock rounding.</p>
                )}
                <AffectedMachines finding={f} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {data.truncated && (
        <p className="text-sm text-muted">
          Showing the top {limit}; {data.findings.some((f) => f.affectedCount !== undefined) ? "more causes" : "more machines"} have a
          bottleneck.
        </p>
      )}
      {notes.length > 0 && (
        <ul aria-label="Bottleneck notes" className="grid gap-0.5 break-words text-sm text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The section while it loads: a heading bar and three rows of a name line and a sentence, like the list. */
export function BottlenecksSkeleton() {
  return (
    <section aria-busy="true" className="panel content-start">
      <SkeletonStatus>Loading bottlenecks…</SkeletonStatus>
      <Skeleton className="h-lh w-32 text-xl" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid gap-1">
          <Skeleton className="h-lh w-40" />
          <Skeleton className="h-lh w-full max-w-xl" />
          <Skeleton className="h-lh w-full max-w-64 text-sm" />
        </div>
      ))}
    </section>
  );
}

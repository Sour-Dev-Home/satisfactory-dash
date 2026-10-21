import type { Bottlenecks } from "@satisfactory-dash/shared";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { detailLine, sectionNotes, stateLabel } from "./bottlenecks";

/**
 * ADR-0048 (#349), Decision 4 item 5: the ranked root causes of underfed and backed-up machines. Each row is the
 * backend's own sentence, with the capping conveyor's tier, rate and position beneath it when there is one. The state
 * is a word, never only a colour.
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
                  {f.buildingName} <span className="font-normal text-warn">· {stateLabel(f.state)}</span>
                </p>
                <p>{f.text}</p>
                {detailLine(f) !== null && <p className="text-sm text-muted">Capped by: {detailLine(f)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {data.truncated && <p className="text-sm text-muted">Showing the top {limit}; more machines have a bottleneck.</p>}
      {notes.length > 0 && (
        <ul aria-label="Bottleneck notes" className="grid gap-0.5 text-sm text-muted">
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

import type { Bottleneck, Bottlenecks } from "@satisfactory-dash/shared";
import { cn } from "../lib/cn";
import { fixLine, machineLabel, sectionNotes, stateLabel } from "./bottlenecks";

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

/** The Factory page's bottleneck notes: why belt data is missing, never how often it refreshes (ADR-0064). */
export const bottleneckNotes = (data: Bottlenecks) => sectionNotes(data, { refresh: false });

/** Whether the full list says more than the summary's lines: any finding, the truncation, or a note. */
export const hasFullList = (data: Bottlenecks) => data.findings.length > 0 || data.truncated || bottleneckNotes(data).length > 0;

/**
 * ADR-0048 (#349), Decision 4 item 5: the ranked root causes of underfed and backed-up machines, one row per cause
 * (#592), shown when the bottleneck card's "Full list" is open (ADR-0064). Each row names its machine (recipe and place
 * when the backend sends them), then the backend's own sentence (which names a capping conveyor, its rate and its place,
 * so no line repeats it: ADR-0064), what would close a deficit, and the machines the cause affects. The state is a word,
 * never only a colour. `data` is already without the small gaps (`withoutSmallGaps`). `labelledBy`: the card's heading.
 */
export function BottlenecksList({ data, limit, labelledBy }: { data: Bottlenecks; limit: number; labelledBy: string }) {
  const notes = bottleneckNotes(data);
  return (
    <>
      {/* Rows ruled like the Factory table's, so ten of them still read as separate findings on a phone (#586). */}
      {data.findings.length > 0 && (
      <ol aria-labelledby={labelledBy} className="grid">
        {data.findings.map((f, i) => (
          <li key={f.buildingId} className="flex gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
            <span aria-hidden="true" className="w-6 shrink-0 text-muted tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 break-words">
              <p className="font-semibold text-fg-strong">
                {/* Underfed in the info colour, so it can't read as healthy beside the amber "Backed up" (#586). */}
                {machineLabel(f)} <span className={cn("font-normal", f.state === "underfed" ? "text-info" : "text-warn")}>· {stateLabel(f.state)}</span>
              </p>
              <p>{f.text}</p>
              {f.fix && <p className="text-sm">Fix: {fixLine(f.fix)}</p>}
              <AffectedMachines finding={f} />
            </div>
          </li>
        ))}
      </ol>
      )}
      {/* One list: the truncation line is a note like the others (#586). */}
      {(data.truncated || notes.length > 0) && (
        <ul aria-label="Bottleneck notes" className="grid gap-1 break-words text-sm text-muted">
          {data.truncated && (
            <li>
              Showing the top {limit}; {data.findings.some((f) => f.affectedCount !== undefined) ? "more causes" : "more machines"} have
              a bottleneck.
            </li>
          )}
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}

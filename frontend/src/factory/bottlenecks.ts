import type { Bottleneck, BottleneckCappedBy, Bottlenecks } from "@satisfactory-dash/shared";
import { formatPerMinute, type RateUnit } from "../format";

/** Pipes carry m³/min, belts and lifts items/min (ADR-0015); the contract's cap has no unit field of its own. */
function capUnit(kind: BottleneckCappedBy["kind"]): RateUnit {
  return kind === "pipe" ? "m3/min" : "items/min";
}

/** "Conveyor Belt Mk.1 · 60 items/min · near (-554, -1278)": the conveyor that caps the flow (ADR-0048). */
export function cappedByLine(cap: BottleneckCappedBy): string {
  const minus = (n: number) => String(n).replace("-", "−");
  return `${cap.tier} · ${formatPerMinute(cap.capacityPerMinute, capUnit(cap.kind))} · near (${minus(cap.at.x)}, ${minus(cap.at.y)})`;
}

/**
 * The detail line under a finding's sentence, or null. Only a step kind this build knows (`logistics`) carries one;
 * any other kind, including one a newer backend adds, shows the finding's `text` alone (forward compatibility).
 */
export function detailLine(finding: Bottleneck): string | null {
  const { rootCause } = finding;
  return rootCause.kind === "logistics" && rootCause.cappedBy ? cappedByLine(rootCause.cappedBy) : null;
}

export const stateLabel = (state: "underfed" | "backedUp") => (state === "underfed" ? "Underfed" : "Backed up");

/**
 * The section's notes, as plain sentences. The backend builds each note's text and the client shows it as is; a note
 * a mode needs but the backend left out is filled from the mode (so an older FRM never loses its "update FRM" line,
 * and `tooLarge` never gets the FRM one).
 */
export function sectionNotes(data: Pick<Bottlenecks, "beltData" | "connectionsRefreshMinutes" | "notes">): string[] {
  const out = data.notes.map((n) => n.text);
  const has = (code: string) => data.notes.some((n) => n.code === code);
  if (data.beltData === "unsupported" && !has("updateFrm")) {
    out.push("Item-level results only. Update FRM to 1.5.4 or newer for belt detail.");
  }
  if (data.beltData === "tooLarge" && !has("beltDataTooLarge")) {
    out.push("Item-level results only: this factory's connection data is too large to read.");
  }
  if ((data.beltData === "present" || data.beltData === "stale") && !has("connectionsRefresh")) {
    const m = data.connectionsRefreshMinutes;
    out.push(`Connections refresh every ${m} ${m === 1 ? "minute" : "minutes"}.`);
  }
  return out;
}

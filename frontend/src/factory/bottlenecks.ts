import type { Bottleneck, BottleneckCappedBy, BottleneckFix, BottleneckMachine, Bottlenecks } from "@satisfactory-dash/shared";
import { formatPerMinute, type RateUnit } from "../format";

/** Pipes carry m³/min, belts and lifts items/min (ADR-0015); the contract's cap has no unit field of its own. */
function capUnit(kind: BottleneckCappedBy["kind"]): RateUnit {
  return kind === "pipe" ? "m3/min" : "items/min";
}

const near = (at: BottleneckCappedBy["at"]) => {
  const minus = (n: number) => String(n).replace("-", "−");
  return `near (${minus(at.x)}, ${minus(at.y)})`;
};

/** "Conveyor Belt Mk.1 · 60 items/min · near (-554, -1278)": the conveyor that caps the flow (ADR-0048). */
export function cappedByLine(cap: BottleneckCappedBy): string {
  return `${cap.tier} · ${formatPerMinute(cap.capacityPerMinute, capUnit(cap.kind))} · ${near(cap.at)}`;
}

/** "Constructor, Iron Plate, near (120, −40)": a machine the way a player finds it (#592). Missing parts are left out. */
export function machineLabel(m: Pick<BottleneckMachine, "buildingName" | "at"> & { recipe?: string | null }): string {
  return [m.buildingName, m.recipe ?? null, m.at ? near(m.at) : null].filter((p) => p !== null && p !== "").join(", ");
}

/** "About 3 more Smelter (Iron Ingot), 30 items/min each": what would close a deficit at full speed (#592). */
export function fixLine(fix: BottleneckFix): string {
  const who = fix.recipe ? `${fix.producerName} (${fix.recipe})` : fix.producerName;
  return `About ${fix.machines} more ${who}, ${formatPerMinute(fix.perMachinePerMinute, fix.unit ?? null)} each, at full speed.`;
}

/**
 * Rated maxima at a set clock can differ from the game's by a rounding step, so a deficit under 2% of what is wanted
 * may be no real shortage (#592).
 */
export function isSmallGap(finding: Bottleneck): boolean {
  const { kind, supplyMaxPerMinute: supply, demandMaxPerMinute: demand } = finding.rootCause;
  return kind === "deficit" && supply !== undefined && demand !== undefined && demand > 0 && (demand - supply) / demand < 0.02;
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
  // A mode's own note only shows in that mode, so a disagreeing backend never puts the FRM line on `tooLarge`.
  const notes = data.notes.filter(
    (n) =>
      (n.code !== "updateFrm" || data.beltData === "unsupported") &&
      (n.code !== "beltDataTooLarge" || data.beltData === "tooLarge"),
  );
  const out = [...new Set(notes.map((n) => n.text))];
  const has = (code: string) => notes.some((n) => n.code === code);
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

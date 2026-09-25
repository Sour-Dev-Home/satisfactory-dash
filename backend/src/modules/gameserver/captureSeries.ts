/**
 * Pure helpers for the dev-only capture script (backend/scripts/captureFactory.ts): they shrink a
 * live getFactory response to what machine-state tuning needs and format the timestamped series
 * file that goes under docs-vault/raw-sources/captured-responses. No I/O, no host, no token: the
 * output can only contain what is passed in, so nothing about the connection can leak into it.
 */

/** The getFactory fields a state replay needs. Everything else (location, BoundingBox, ColorSlot,
 *  features, ...) is dropped to keep a 30-sample series small. */
const KEPT_FACTORY_FIELDS = [
  "ID",
  "Name",
  "ClassName",
  "Recipe",
  "IsConfigured",
  "IsProducing",
  "IsPaused",
  "production",
  "ingredients",
  "InputInventory",
  "OutputInventory",
  "Productivity",
  "ManuSpeed",
  "PowerInfo",
] as const;

export function trimFactoryBuilding(building: unknown): Record<string, unknown> {
  if (typeof building !== "object" || building === null) {
    return {};
  }
  const source = building as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FACTORY_FIELDS) {
    if (field in source) {
      kept[field] = source[field];
    }
  }
  return kept;
}

export interface CaptureSample {
  /** ISO time of the poll. */
  at: string;
  /** Trimmed getFactory buildings; null when that poll failed. */
  factory: Record<string, unknown>[] | null;
  /** getPower circuits as returned; null when that poll failed. */
  power: unknown[] | null;
}

export function buildSample(at: Date, factory: unknown, power: unknown): CaptureSample {
  return {
    at: at.toISOString(),
    factory: Array.isArray(factory) ? factory.map(trimFactoryBuilding) : null,
    power: Array.isArray(power) ? power : null,
  };
}

/** The file name for a run started at `start`, e.g. frm-factory-series-20260925T101500Z.json. */
export function seriesFileName(start: Date): string {
  const stamp = start.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `frm-factory-series-${stamp}.json`;
}

/** The provenance lines the other captures carry, then `---`, then the JSON array of samples. */
export function formatSeries(input: { start: Date; intervalSeconds: number; samples: CaptureSample[] }): string {
  const header = [
    `Captured: ${input.start.toISOString()}, ${input.samples.length} samples about ${input.intervalSeconds} s apart, live dedicated server (FRM Web Server, direct transport).`,
    "Method: repeated GET /getFactory and GET /getPower by backend/scripts/captureFactory.ts.",
    "Trimmed: each building keeps only the fields machine-state tuning reads (see gameserver/captureSeries.ts); location, BoundingBox, ColorSlot and features are dropped. A null factory or power means that poll failed.",
    "Purpose: tune the PROVISIONAL machine-state thresholds (ADR-0027, telemetry/services/classifyBuilding.ts).",
    "",
    "---",
    "",
  ].join("\n");
  return `${header}${JSON.stringify(input.samples)}\n`;
}

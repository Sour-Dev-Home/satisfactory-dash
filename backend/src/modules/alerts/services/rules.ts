import { z } from "zod";

/**
 * ADR-0027 decision 4, the rule kinds and their parameters. The params of a stored rule are validated by a zod
 * schema per kind on write AND on read (they live in a jsonb column): a rule whose params cannot be read is skipped
 * with a logged code and never crashes a tick.
 */

export const RULE_KINDS = ["power_outage", "fuse_trip", "stopped_machines", "server_unreachable", "production_below_target"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

const NoParamsSchema = z.strictObject({});

export const StoppedMachinesParamsSchema = z.strictObject({
  /** A machine counts as stopped when it is `underfed` (short of input) or `backedUp` (output full) AND its best
   *  output percent is below this (ADR-0027 decision 4: "backedUp or starved", amendment 2: "below about 5%"). */
  stoppedBelowPercent: z.number().min(0).max(100).default(5),
});

export const ServerUnreachableParamsSchema = z.strictObject({
  /** The status poll must have failed this many times in a row... */
  failedPolls: z.number().int().min(1).max(1000).default(3),
  /** ...AND for at least this long (auto-pause is not unreachable, and a blip is not an outage). */
  minSeconds: z.number().int().min(0).max(86_400).default(120),
});

export const PRODUCTION_WINDOW_MIN_MINUTES = 5;
export const PRODUCTION_WINDOW_MAX_MINUTES = 60;
/** Amendment 3: fires below this share of the target, clears above the other (a hysteresis band, so 92% never flaps). */
export const PRODUCTION_FIRE_BELOW_SHARE = 0.9;
export const PRODUCTION_CLEAR_ABOVE_SHARE = 0.95;

export const ProductionBelowTargetParamsSchema = z.strictObject({
  /** The item's class name (e.g. `Desc_IronPlate_C`): game data, never trusted as text. */
  item: z.string().min(1).max(200),
  /** The wanted factory-wide production, items per minute. */
  targetPerMinute: z.number().positive().finite(),
  /** The rolling window the average is taken over. */
  windowMinutes: z.number().min(PRODUCTION_WINDOW_MIN_MINUTES).max(PRODUCTION_WINDOW_MAX_MINUTES).default(10),
});

export type StoppedMachinesParams = z.infer<typeof StoppedMachinesParamsSchema>;
export type ServerUnreachableParams = z.infer<typeof ServerUnreachableParamsSchema>;
export type ProductionBelowTargetParams = z.infer<typeof ProductionBelowTargetParamsSchema>;

export type ParsedRuleParams =
  | { kind: "power_outage"; params: Record<string, never> }
  | { kind: "fuse_trip"; params: Record<string, never> }
  | { kind: "stopped_machines"; params: StoppedMachinesParams }
  | { kind: "server_unreachable"; params: ServerUnreachableParams }
  | { kind: "production_below_target"; params: ProductionBelowTargetParams };

/** A rule as the engine sees it: validated, for one server (by its public id). */
export type Rule = ParsedRuleParams & {
  id: string;
  serverPublicId: string;
  forSeconds: number;
  clearSeconds: number;
  repeatSeconds: number;
  severity: Severity;
};

/** Validates raw params (from the database or, in PR 7, from a request). Never throws. */
export function parseRuleParams(kind: string, raw: unknown): ParsedRuleParams | undefined {
  switch (kind) {
    case "power_outage":
    case "fuse_trip": {
      const parsed = NoParamsSchema.safeParse(raw ?? {});
      return parsed.success ? { kind, params: {} } : undefined;
    }
    case "stopped_machines": {
      const parsed = StoppedMachinesParamsSchema.safeParse(raw ?? {});
      return parsed.success ? { kind, params: parsed.data } : undefined;
    }
    case "server_unreachable": {
      const parsed = ServerUnreachableParamsSchema.safeParse(raw ?? {});
      return parsed.success ? { kind, params: parsed.data } : undefined;
    }
    case "production_below_target": {
      // No `?? {}`: the item and the target have no default, so missing params are refused.
      const parsed = ProductionBelowTargetParamsSchema.safeParse(raw);
      return parsed.success ? { kind, params: parsed.data } : undefined;
    }
    default:
      return undefined;
  }
}

export interface PresetDefaults {
  kind: RuleKind;
  params: Record<string, unknown>;
  forSeconds: number;
  clearSeconds: number;
  repeatSeconds: number;
  severity: Severity;
}

/**
 * The rules seeded for every server (idempotently, existing servers included). `fuse_trip` is NOT seeded: today the
 * dashboard's "outage" status IS a tripped fuse (powerService.classifyPowerCircuit), so `power_outage` and `fuse_trip`
 * would raise two alerts for one event; the kind exists for when the two can differ. "Newly underfed" is not offered
 * (ADR-0027 amendment 2), and "production below target" (amendment 3) is opt-in per item, so it has NO preset.
 */
export const PRESET_RULES: readonly PresetDefaults[] = [
  { kind: "power_outage", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
  // "Stopped machines": below about 5 percent for 5 minutes (ADR-0027 amendment 2), cleared after 2 minutes.
  { kind: "stopped_machines", params: { stoppedBelowPercent: 5 }, forSeconds: 300, clearSeconds: 120, repeatSeconds: 3600, severity: "warning" },
  { kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 }, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
];

/** Every kind's defaults, seeded or not, for a rule created later (PR 7). `params` here are only the optional ones. */
export const DEFAULTS_BY_KIND: Readonly<Record<RuleKind, PresetDefaults>> = {
  // Amendment 3: `for` 10 min, clear 5 min, repeat 1 h.
  production_below_target: { kind: "production_below_target", params: { windowMinutes: 10 }, forSeconds: 600, clearSeconds: 300, repeatSeconds: 3600, severity: "warning" },
  power_outage: PRESET_RULES[0]!,
  fuse_trip: { kind: "fuse_trip", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
  stopped_machines: PRESET_RULES[1]!,
  server_unreachable: PRESET_RULES[2]!,
};

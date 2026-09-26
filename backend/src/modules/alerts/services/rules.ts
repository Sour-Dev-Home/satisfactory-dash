import { z } from "zod";

/**
 * ADR-0027 decision 4, the rule kinds and their parameters. The params of a stored rule are validated by a zod
 * schema per kind on write AND on read (they live in a jsonb column): a rule whose params cannot be read is skipped
 * with a logged code and never crashes a tick.
 */

export const RULE_KINDS = ["power_outage", "fuse_trip", "stopped_machines", "server_unreachable"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

const NoParamsSchema = z.strictObject({});

export const StoppedMachinesParamsSchema = z.strictObject({
  /** A machine counts as stopped when it is `underfed` and its best output percent is below this (ADR-0027 amendment 2). */
  stoppedBelowPercent: z.number().min(0).max(100).default(5),
});

export const ServerUnreachableParamsSchema = z.strictObject({
  /** The status poll must have failed this many times in a row... */
  failedPolls: z.number().int().min(1).max(1000).default(3),
  /** ...AND for at least this long (auto-pause is not unreachable, and a blip is not an outage). */
  minSeconds: z.number().int().min(0).max(86_400).default(120),
});

export type StoppedMachinesParams = z.infer<typeof StoppedMachinesParamsSchema>;
export type ServerUnreachableParams = z.infer<typeof ServerUnreachableParamsSchema>;

export type ParsedRuleParams =
  | { kind: "power_outage"; params: Record<string, never> }
  | { kind: "fuse_trip"; params: Record<string, never> }
  | { kind: "stopped_machines"; params: StoppedMachinesParams }
  | { kind: "server_unreachable"; params: ServerUnreachableParams };

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
 * (ADR-0027 amendment 2), and "production below target" is undecided.
 */
export const PRESET_RULES: readonly PresetDefaults[] = [
  { kind: "power_outage", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
  // "Stopped machines": below about 5 percent for 5 minutes (ADR-0027 amendment 2), cleared after 2 minutes.
  { kind: "stopped_machines", params: { stoppedBelowPercent: 5 }, forSeconds: 300, clearSeconds: 120, repeatSeconds: 3600, severity: "warning" },
  { kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 }, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
];

/** Every kind's defaults, seeded or not, for a rule created later (PR 7). */
export const DEFAULTS_BY_KIND: Readonly<Record<RuleKind, PresetDefaults>> = {
  power_outage: PRESET_RULES[0]!,
  fuse_trip: { kind: "fuse_trip", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
  stopped_machines: PRESET_RULES[1]!,
  server_unreachable: PRESET_RULES[2]!,
};

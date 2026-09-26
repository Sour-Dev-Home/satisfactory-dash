import {
  CreateAlertRuleRequestSchema,
  KNOWN_SEVERITIES,
  ProductionBelowTargetParamsSchema,
  ProductionBelowTargetUpdateParamsSchema,
  ServerUnreachableParamsSchema,
  StoppedMachinesParamsSchema,
  UpdateAlertRuleRequestSchema,
  type AlertRule,
  type CreateAlertRuleRequest,
  type UpdateAlertRuleRequest,
} from "@satisfactory-dash/shared";
import type { ItemLabel } from "../../factory/itemLabels";

/**
 * The rules editor's form state and the requests it becomes (ADR-0027 PR 9b). Every duration is
 * edited in minutes and sent as whole seconds; the bounds are checked after that rounding, with
 * the contract's own schemas, so the editor never sends what the backend would refuse.
 */

/** An item the editor can offer: ItemLabel-shaped, with its class name (9c builds these from the live factory). */
export type EditorItem = ItemLabel & { className: string };

// Kind and severity names come from ../alertText.ts, so the editor and the log say the same words.
export const isKnownSeverity = (s: string): s is (typeof KNOWN_SEVERITIES)[number] => (KNOWN_SEVERITIES as readonly string[]).includes(s);

/** A form field's id; each maps to one input and one error message. */
export type Field =
  | "severity"
  | "forMinutes"
  | "clearMinutes"
  | "repeatMinutes"
  | "stoppedBelowPercent"
  | "failedPolls"
  | "minMinutes"
  | "item"
  | "targetPerMinute"
  | "windowMinutes";

/** What each field accepts, in the words and units the form uses (the schemas' bounds, in minutes). */
export const FIELD_HINT: Record<Field, string> = {
  severity: "Choose a severity.",
  forMinutes: "From 0 to 1,440 minutes.",
  clearMinutes: "From 0 to 1,440 minutes.",
  repeatMinutes: "From 1 to 10,080 minutes (7 days).",
  stoppedBelowPercent: "From 0 to 100 %.",
  failedPolls: "A whole number from 1 to 1,000.",
  minMinutes: "From 0 to 1,440 minutes.",
  item: "Choose an item.",
  targetPerMinute: "More than 0.",
  windowMinutes: "From 5 to 60 minutes.",
};

/** Seconds to the minutes shown in a field: whole, or one decimal ("1.5"). */
export const toMinutesText = (seconds: number) => String(Math.round((seconds / 60) * 10) / 10);
/** Seconds as text for the read-only view. */
export const minutesText = (seconds: number) => `${toMinutesText(seconds)} min`;

/** A field's number, or null when it isn't one ("", "abc"). */
function num(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
const toSeconds = (minutesText: string) => {
  const n = num(minutesText);
  return n === null ? null : Math.round(n * 60);
};

export interface Draft {
  enabled: boolean;
  severity: string;
  forMinutes: string;
  clearMinutes: string;
  repeatMinutes: string;
  /** The kind's own settings as field text; empty for a kind the editor doesn't edit. */
  params: Partial<Record<Field, string>>;
}

/** The rule's editable settings, or null when its kind (or its stored params) isn't one the editor knows. */
export function knownParams(rule: AlertRule): Partial<Record<Field, string>> | null {
  switch (rule.kind) {
    case "power_outage":
    case "fuse_trip":
      return {};
    case "stopped_machines": {
      const p = StoppedMachinesParamsSchema.safeParse(rule.params);
      return p.success ? { stoppedBelowPercent: String(p.data.stoppedBelowPercent) } : null;
    }
    case "server_unreachable": {
      const p = ServerUnreachableParamsSchema.safeParse(rule.params);
      return p.success ? { failedPolls: String(p.data.failedPolls), minMinutes: toMinutesText(p.data.minSeconds) } : null;
    }
    case "production_below_target": {
      const p = ProductionBelowTargetParamsSchema.safeParse(rule.params);
      return p.success
        ? { item: p.data.item, targetPerMinute: String(p.data.targetPerMinute), windowMinutes: String(p.data.windowMinutes) }
        : null;
    }
    default:
      return null;
  }
}

export function draftFrom(rule: AlertRule): Draft {
  return {
    enabled: rule.enabled,
    severity: rule.severity,
    forMinutes: toMinutesText(rule.forSeconds),
    clearMinutes: toMinutesText(rule.clearSeconds),
    repeatMinutes: toMinutesText(rule.repeatSeconds),
    params: knownParams(rule) ?? {},
  };
}

export type Errors = Partial<Record<Field, string>>;
export type Built<T> = { ok: true; request: T } | { ok: false; errors: Errors };

/** The params a PATCH carries for this kind (never the item), or undefined when nothing changed. */
function paramsUpdate(rule: AlertRule, draft: Draft, errors: Errors): Record<string, unknown> | undefined {
  const before = knownParams(rule);
  if (before === null) return undefined; // a kind the editor doesn't edit: its params are never touched
  // Untouched text is the stored value, so it needs no checking.
  const edited = (Object.keys(draft.params) as Field[]).some((f) => draft.params[f] !== before[f]);
  if (!edited) return undefined;
  const value = (f: Field) => num(draft.params[f] ?? "");
  // Compare numbers, not text, like the durations: "5.0" for a stored 5 changes nothing.
  const unchanged = (next: Record<string, unknown>) => Object.entries(next).every(([k, v]) => rule.params[k] === v);
  if (rule.kind === "stopped_machines") {
    const parsed = StoppedMachinesParamsSchema.safeParse({ stoppedBelowPercent: value("stoppedBelowPercent") });
    if (!parsed.success) errors.stoppedBelowPercent = FIELD_HINT.stoppedBelowPercent;
    return parsed.success && !unchanged(parsed.data) ? parsed.data : undefined;
  }
  if (rule.kind === "server_unreachable") {
    const minMinutes = toSeconds(draft.params.minMinutes ?? "");
    const parsed = ServerUnreachableParamsSchema.safeParse({ failedPolls: value("failedPolls"), minSeconds: minMinutes });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "failedPolls") errors.failedPolls = FIELD_HINT.failedPolls;
        if (issue.path[0] === "minSeconds") errors.minMinutes = FIELD_HINT.minMinutes;
      }
    }
    return parsed.success && !unchanged(parsed.data) ? parsed.data : undefined;
  }
  if (rule.kind === "production_below_target") {
    const parsed = ProductionBelowTargetUpdateParamsSchema.safeParse({
      targetPerMinute: value("targetPerMinute"),
      windowMinutes: value("windowMinutes"),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "targetPerMinute") errors.targetPerMinute = FIELD_HINT.targetPerMinute;
        if (issue.path[0] === "windowMinutes") errors.windowMinutes = FIELD_HINT.windowMinutes;
      }
    }
    return parsed.success && !unchanged(parsed.data) ? parsed.data : undefined;
  }
  return undefined;
}

/**
 * The PATCH for what changed in the draft (ADR-0027 PR 9b): only changed fields, validated with
 * the contract. `null` when nothing changed, so Save has nothing to send.
 */
export function buildUpdate(rule: AlertRule, draft: Draft): Built<UpdateAlertRuleRequest> | null {
  const errors: Errors = {};
  const body: UpdateAlertRuleRequest = {};
  if (draft.enabled !== rule.enabled) body.enabled = draft.enabled;
  if (draft.severity !== rule.severity) {
    if (isKnownSeverity(draft.severity)) body.severity = draft.severity;
    else errors.severity = FIELD_HINT.severity;
  }
  const timing = [
    ["forMinutes", "forSeconds"],
    ["clearMinutes", "clearSeconds"],
    ["repeatMinutes", "repeatSeconds"],
  ] as const;
  for (const [field, key] of timing) {
    const seconds = toSeconds(draft[field]);
    if (seconds === null) {
      errors[field] = FIELD_HINT[field];
      continue;
    }
    if (seconds === rule[key]) continue;
    // Bounds after rounding: "0.5" minutes of repeat is 30 s, under the 60 s minimum.
    const one = UpdateAlertRuleRequestSchema.safeParse({ [key]: seconds });
    if (one.success) body[key] = seconds;
    else errors[field] = FIELD_HINT[field];
  }
  const params = paramsUpdate(rule, draft, errors);
  if (params) body.params = params;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(body).length === 0) return null;
  const checked = UpdateAlertRuleRequestSchema.safeParse(body);
  return checked.success ? { ok: true, request: body } : { ok: false, errors: { severity: FIELD_HINT.severity } };
}

export interface NewTargetDraft {
  item: string;
  targetPerMinute: string;
  windowMinutes: string;
  severity: string;
}

export const NEW_TARGET: NewTargetDraft = { item: "", targetPerMinute: "", windowMinutes: "10", severity: "warning" };

/**
 * The POST for a new production target: the item, target and window, plus severity only when the
 * user chose another than the default. The contract's defaults fill in the timing.
 */
export function buildCreate(draft: NewTargetDraft): Built<CreateAlertRuleRequest> {
  const errors: Errors = {};
  if (draft.item === "") errors.item = FIELD_HINT.item;
  const target = num(draft.targetPerMinute);
  const window = num(draft.windowMinutes);
  const params = { item: draft.item, targetPerMinute: target, windowMinutes: window };
  const parsed = ProductionBelowTargetParamsSchema.safeParse(params);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "targetPerMinute") errors.targetPerMinute = FIELD_HINT.targetPerMinute;
      if (issue.path[0] === "windowMinutes") errors.windowMinutes = FIELD_HINT.windowMinutes;
      if (issue.path[0] === "item") errors.item = FIELD_HINT.item;
    }
  }
  if (!isKnownSeverity(draft.severity)) errors.severity = FIELD_HINT.severity;
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  const request: CreateAlertRuleRequest = {
    kind: "production_below_target",
    params: parsed.data,
    ...(draft.severity !== NEW_TARGET.severity && isKnownSeverity(draft.severity) ? { severity: draft.severity } : {}),
  };
  const checked = CreateAlertRuleRequestSchema.safeParse(request);
  return checked.success ? { ok: true, request } : { ok: false, errors: { targetPerMinute: FIELD_HINT.targetPerMinute } };
}

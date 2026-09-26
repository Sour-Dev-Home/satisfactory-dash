import {
  PowerOutageSummarySchema,
  ProductionBelowTargetSummarySchema,
  ServerUnreachableSummarySchema,
  StoppedMachinesSummarySchema,
  type AlertEvent,
} from "@satisfactory-dash/shared";
import { formatDuration, formatPerMinute } from "../format";
import { labelFor } from "../factory/itemLabels";

/**
 * Words for the alerts contract (ADR-0027 PR 7a). Its kinds, severities, transitions and reasons
 * arrive as plain strings (a newer backend may add values), so every lookup here has a readable
 * fallback instead of assuming the known list is complete.
 */

const KIND_LABEL: Record<string, string> = {
  power_outage: "Power outage",
  fuse_trip: "Fuse trip",
  stopped_machines: "Stopped machines",
  server_unreachable: "Game server unreachable",
  production_below_target: "Production below target",
};

/** "power_outage" -> "Power outage"; an unknown kind is spelled out from its name. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? spellOut(kind);
}

const SEVERITY_LABEL: Record<string, string> = { info: "Info", warning: "Warning", critical: "Critical" };

export function severityLabel(severity: string): string {
  return SEVERITY_LABEL[severity] ?? spellOut(severity);
}

/** Text colour per severity: the token utilities, never a raw colour. Unknown is neutral. */
export function severityClass(severity: string): string {
  if (severity === "critical") return "text-bad";
  if (severity === "warning") return "text-warn";
  return "text-muted";
}

const TRANSITION_LABEL: Record<string, string> = {
  fired: "Started",
  updated: "Changed",
  renotify: "Still going",
  resolved: "Resolved",
};

export function transitionLabel(transition: string): string {
  return TRANSITION_LABEL[transition] ?? spellOut(transition);
}

/**
 * What an alert is about: "circuit:3" -> "Circuit 3", "server" -> "The game server". A production
 * alert's subject is just "item": pass its item class (from the event's summary or the rule's
 * params) to name it.
 */
export function subjectLabel(subject: string, item?: string): string {
  const circuit = /^circuit:(\d+)$/.exec(subject);
  if (circuit) return `Circuit ${circuit[1]}`;
  if (subject === "server") return "The game server";
  if (subject === "group") return "Machines";
  if (subject === "item") return item ? labelFor(new Map(), item).name : "An item";
  return subject;
}

/** The item class in a rule's params or an event's summary, when there is one. */
export function itemOf(record: Record<string, unknown> | undefined): string | undefined {
  const item = record?.item;
  return typeof item === "string" && item !== "" ? item : undefined;
}

const DISABLED_REASON: Record<string, string> = {
  webhook_gone: "Discord says this webhook no longer exists. Set a new one to resume alerts.",
  invalid_url: "The saved webhook address was refused. Set a new one to resume alerts.",
  manual: "Turned off by an owner or admin.",
};

/** Why the Discord destination is off; null while it's on. */
export function disabledReasonText(reason: string | null): string | null {
  if (reason === null) return null;
  return DISABLED_REASON[reason] ?? `Turned off (${reason}).`;
}

/**
 * One line of detail for a logged event, from its game-data summary. Parsed with the kind's own
 * schema; anything unknown or malformed gives null (the kind and subject still show).
 */
export function eventDetail(event: Pick<AlertEvent, "kind" | "summary">): string | null {
  switch (event.kind) {
    case "power_outage": {
      const s = PowerOutageSummarySchema.safeParse(event.summary);
      return s.success ? `Circuit ${s.data.circuit} lost power.` : null;
    }
    case "server_unreachable": {
      const s = ServerUnreachableSummarySchema.safeParse(event.summary);
      return s.success
        ? `${s.data.failedPolls} failed ${s.data.failedPolls === 1 ? "check" : "checks"} in a row, down for ${formatDuration(s.data.downForSeconds)}.`
        : null;
    }
    case "stopped_machines": {
      const s = StoppedMachinesSummarySchema.safeParse(event.summary);
      if (!s.success) return null;
      const reasons = s.data.byReason.map((r) => `${r.count} ${reasonText(r.reason)}`).join(", ");
      const machines = `${s.data.machines} ${s.data.machines === 1 ? "machine" : "machines"} stopped`;
      return reasons ? `${machines}: ${reasons}.` : `${machines}.`;
    }
    case "production_below_target": {
      const s = ProductionBelowTargetSummarySchema.safeParse(event.summary);
      if (!s.success) return null;
      const item = labelFor(new Map(), s.data.item);
      const target = formatPerMinute(s.data.targetPerMinute, item.unit);
      // A reminder sent while the window refills has no average (the contract says so).
      return s.data.averagePerMinute === undefined
        ? `${item.name}: target ${target} over ${s.data.windowMinutes} min.`
        : `${item.name}: ${formatPerMinute(s.data.averagePerMinute, item.unit)} against a target of ${target} over ${s.data.windowMinutes} min.`;
    }
    default:
      return null;
  }
}

/** "output full" / "input short" / "input short: Desc_Coal_C" -> readable words. */
function reasonText(reason: string): string {
  const short = /^input short: (.+)$/.exec(reason);
  if (short) return `short of ${labelFor(new Map(), short[1]).name}`;
  if (reason === "input short") return "short of input";
  return reason;
}

function spellOut(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
}

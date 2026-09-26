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

/**
 * An alert's one-line title: "Power outage: Circuit 3", "Production below target: Iron Plate". A
 * subject that only repeats the kind (the stopped-machines group, the game server) is left out:
 * "Stopped machines", not "Stopped machines: Machines".
 */
export function alertTitle(kind: string, subject: string, item?: string): string {
  if (subject === "group" || subject === "server") return kindLabel(kind);
  return `${kindLabel(kind)}: ${subjectLabel(subject, item)}`;
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

const SEND_TEST_FAILED: Record<string, string> = {
  webhook_gone: "Discord says this webhook no longer exists, so it was turned off. Set a new webhook.",
  rejected: "Discord refused the test message. Check the webhook in your Discord channel's settings.",
  rate_limited: "Discord is limiting messages to this webhook right now. Try again in a minute.",
  unavailable: "Discord couldn't be reached. Try again later.",
  destination_disabled: "The webhook is turned off. Turn it on to send a test.",
  secret_unreadable: "The saved webhook can't be read on the server. Set the webhook again.",
};

/**
 * What a "Send test" answer means (SendTestResponse). `demo`: the demo build answers without any
 * network call (ADR-0027 item 7), so it says so rather than claiming a message went out.
 */
export function sendTestText(answer: { ok: true } | { ok: false; code: string }, demo = false): string {
  if (answer.ok) return demo ? "Sent (demo): nothing was sent to Discord." : "Sent. Check your Discord channel.";
  const known = SEND_TEST_FAILED[answer.code];
  if (known) return known;
  const code = spellOut(answer.code).toLowerCase();
  return code ? `Discord didn't take the test (${code}).` : "Discord didn't take the test.";
}

/** Whether a role may change the server's alerts (ADR-0027 PR 7b). Absent or unknown is read-only. */
export function canEditAlerts(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
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

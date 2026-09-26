import {
  CreateAlertRuleRequestSchema,
  PatchDiscordDestinationRequestSchema,
  PutDiscordDestinationRequestSchema,
  SetMuteRequestSchema,
  UpdateAlertRuleRequestSchema,
  type AlertDestinationsResponse,
  type AlertEvent,
  type AlertEventsResponse,
  type AlertRule,
  type AlertStatusResponse,
} from "@satisfactory-dash/shared";

/**
 * The demo world's alerts (ADR-0027 PR 9, decision 7): the preset rules and one production target,
 * two alerts firing and three resolved, and a Discord webhook that is only pretend. Writes change
 * this tab's memory and nothing else; "Send test" answers without contacting anyone. Times are
 * relative to the demo clock, so the log always reads as recent.
 */

const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

// Fixed ids, so a rule keeps its id across the demo's reads.
const RULE = {
  outage: "0d1f7c5e-1a0b-4c3d-8e9f-000000000001",
  fuse: "0d1f7c5e-1a0b-4c3d-8e9f-000000000002",
  stopped: "0d1f7c5e-1a0b-4c3d-8e9f-000000000003",
  unreachable: "0d1f7c5e-1a0b-4c3d-8e9f-000000000004",
  ironPlate: "0d1f7c5e-1a0b-4c3d-8e9f-000000000005",
} as const;

interface AlertState {
  rules: AlertRule[] | null;
  discord: AlertDestinationsResponse["discord"] | "unset";
  mutedUntil: string | null;
  nextRule: number;
}

const state: AlertState = { rules: null, discord: "unset", mutedUntil: null, nextRule: 6 };

export function resetDemoAlerts(): void {
  Object.assign(state, { rules: null, discord: "unset", mutedUntil: null, nextRule: 6 });
}

function preset(id: string, kind: string, params: Record<string, unknown>, severity: string, forSeconds: number, created: string): AlertRule {
  return { id, kind, params, forSeconds, clearSeconds: 300, repeatSeconds: 3600, severity, enabled: true, preset: true, createdAt: created, updatedAt: created };
}

/** The rules, built on first use from the demo clock. */
export function rules(now: number): AlertRule[] {
  if (state.rules === null) {
    const created = iso(now - 3 * 24 * 60 * MIN);
    state.rules = [
      preset(RULE.outage, "power_outage", {}, "critical", 0, created),
      preset(RULE.fuse, "fuse_trip", {}, "critical", 0, created),
      preset(RULE.stopped, "stopped_machines", { stoppedBelowPercent: 5 }, "warning", 300, created),
      preset(RULE.unreachable, "server_unreachable", { failedPolls: 3, minSeconds: 120 }, "warning", 0, created),
      {
        ...preset(RULE.ironPlate, "production_below_target", { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 }, "warning", 600, created),
        preset: false,
      },
    ];
  }
  return state.rules;
}

export function destinations(now: number): AlertDestinationsResponse {
  if (state.discord === "unset") {
    state.discord = { last4: "Xq7d", enabled: true, disabledReason: null, updatedAt: iso(now - 2 * 24 * 60 * MIN) };
  }
  return { discord: state.discord };
}

export function status(now: number): AlertStatusResponse {
  // A mute that has run out is over, as on the real backend.
  if (state.mutedUntil !== null && Date.parse(state.mutedUntil) <= now) state.mutedUntil = null;
  return { deliveryEnabled: true, mutedUntil: state.mutedUntil, firing: firing(now) };
}

function firing(now: number): AlertStatusResponse["firing"] {
  const enabled = new Set(rules(now).filter((r) => r.enabled).map((r) => r.id));
  return [
    { ruleId: RULE.ironPlate, kind: "production_below_target", subject: "item", severity: "warning", since: iso(now - 25 * MIN) },
    { ruleId: RULE.stopped, kind: "stopped_machines", subject: "group", severity: "warning", since: iso(now - 40 * MIN) },
  ].filter((alert) => enabled.has(alert.ruleId));
}

/** The log, newest first: the two firing alerts, and three that fired and resolved earlier. */
function log(now: number): AlertEvent[] {
  const at = (minutesAgo: number) => iso(now - minutesAgo * MIN);
  const event = (id: number, minutesAgo: number, ruleId: string, kind: string, severity: string, subject: string, transition: string, summary: Record<string, unknown>): AlertEvent => ({
    id: String(id),
    at: at(minutesAgo),
    ruleId,
    kind,
    severity,
    subject,
    transition,
    summary,
  });
  const ironPlate = { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 };
  const stopped = { machines: 4, byRecipe: [{ recipe: "Iron Plate", count: 3 }, { recipe: "Screw", count: 1 }], byReason: [{ reason: "input short: Desc_IronIngot_C", count: 3 }, { reason: "output full", count: 1 }] };
  return [
    event(9, 25, RULE.ironPlate, "production_below_target", "warning", "item", "fired", { ...ironPlate, averagePerMinute: 84 }),
    event(8, 40, RULE.stopped, "stopped_machines", "warning", "group", "fired", stopped),
    event(7, 5 * 60, RULE.outage, "power_outage", "critical", "circuit:1", "resolved", { circuit: 1 }),
    event(6, 5 * 60 + 12, RULE.outage, "power_outage", "critical", "circuit:1", "fired", { circuit: 1 }),
    event(5, 20 * 60, RULE.fuse, "fuse_trip", "critical", "circuit:0", "resolved", {}),
    event(4, 20 * 60 + 3, RULE.fuse, "fuse_trip", "critical", "circuit:0", "fired", {}),
    event(3, 30 * 60, RULE.unreachable, "server_unreachable", "warning", "server", "resolved", { failedPolls: 5, downForSeconds: 300 }),
    event(2, 30 * 60 + 5, RULE.unreachable, "server_unreachable", "warning", "server", "fired", { failedPolls: 3, downForSeconds: 120 }),
  ];
}

/** A page of the log, like the backend: newest first, `before` an event id, `nextBefore` for more. */
export function events(now: number, limit: number, before?: string): AlertEventsResponse {
  const older = log(now).filter((e) => before === undefined || BigInt(e.id) < BigInt(before));
  const page = older.slice(0, limit);
  return { events: page, nextBefore: older.length > limit ? page[page.length - 1].id : null };
}

type Answer = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const fail = (status: number, code: string, message: string, reason?: string): Answer => ({
  status,
  body: { error: { code, message, requestId: "demo", ...(reason ? { reason } : {}) } },
});

export function createRule(now: number, body: unknown): Answer {
  const parsed = CreateAlertRuleRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", "That rule isn't valid.");
  const created = iso(now);
  const rule: AlertRule = { ...parsed.data, id: `0d1f7c5e-1a0b-4c3d-8e9f-${String(state.nextRule++).padStart(12, "0")}`, preset: false, createdAt: created, updatedAt: created };
  rules(now).push(rule);
  return ok({ rule }, 201);
}

export function updateRule(now: number, ruleId: string, body: unknown): Answer {
  const parsed = UpdateAlertRuleRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", "That change isn't valid.");
  const list = rules(now);
  const index = list.findIndex((r) => r.id === ruleId);
  if (index < 0) return fail(404, "rule_not_found", "That rule doesn't exist.");
  if (parsed.data.params && "item" in parsed.data.params) {
    return fail(422, "rule_item_immutable", "A rule's item can't be changed: delete it and create a new one.");
  }
  const { params, ...rest } = parsed.data;
  const rule: AlertRule = { ...list[index], ...rest, params: { ...list[index].params, ...params }, updatedAt: iso(now) };
  list[index] = rule;
  return ok({ rule });
}

export function deleteRule(now: number, ruleId: string): Answer {
  const list = rules(now);
  const rule = list.find((r) => r.id === ruleId);
  if (!rule) return fail(404, "rule_not_found", "That rule doesn't exist.");
  if (rule.preset) return fail(409, "preset_disable_only", "A preset rule can be turned off, not deleted.");
  state.rules = list.filter((r) => r.id !== ruleId);
  return ok({ deleted: true });
}

// The backend's webhook rules (backend/src/modules/alerts/services/discordWebhook.ts), mirrored so the
// demo accepts and refuses the same URLs with the same `reason`. Nothing is ever contacted.
const WEBHOOK_HOSTS = ["discord.com", "discordapp.com"];
const WEBHOOK_PATH = /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{20,120}$/;

/** The canonical URL's last 4 characters, or why the backend would refuse it. */
export function checkWebhook(raw: string): { last4: string } | { reason: string } {
  const input = raw.trim();
  if (input.length === 0) return { reason: "not_a_url" };
  if (input.length > 300) return { reason: "too_long" };
  if ([...input].some((c) => /[\s\\%]/.test(c) || c.codePointAt(0)! <= 0x20 || (c.codePointAt(0)! >= 0x7f && c.codePointAt(0)! <= 0x9f))) {
    return { reason: "not_a_url" };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { reason: "not_a_url" };
  }
  if (url.protocol !== "https:") return { reason: "not_https" };
  if (url.username !== "" || url.password !== "") return { reason: "credentials_in_url" };
  if (!WEBHOOK_HOSTS.includes(url.hostname)) return { reason: "host_not_allowed" };
  if (url.port !== "") return { reason: "port_not_allowed" };
  if (url.search !== "" || url.hash !== "") return { reason: "query_or_fragment" };
  if (!WEBHOOK_PATH.test(url.pathname)) return { reason: "path_not_a_webhook" };
  if (input.includes("?") || input.includes("#")) return { reason: "query_or_fragment" };
  return { last4: `https://${url.hostname}${url.pathname}`.slice(-4) };
}

export function putDiscord(now: number, body: unknown): Answer {
  const parsed = PutDiscordDestinationRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", "That request isn't valid.");
  const checked = checkWebhook(parsed.data.webhookUrl);
  if ("reason" in checked) return fail(422, "webhook_invalid", "That is not a valid Discord webhook URL", checked.reason);
  // Only the last 4 characters are kept: the URL itself is forgotten at once, as on the backend.
  state.discord = { last4: checked.last4, enabled: true, disabledReason: null, updatedAt: iso(now) };
  return ok({ discord: state.discord });
}

export function patchDiscord(now: number, body: unknown): Answer {
  const parsed = PatchDiscordDestinationRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", "That request isn't valid.");
  const current = destinations(now).discord;
  if (!current) return fail(404, "destination_not_configured", "No Discord webhook is set up for this server");
  state.discord = { ...current, enabled: parsed.data.enabled, disabledReason: parsed.data.enabled ? null : "manual", updatedAt: iso(now) };
  return ok({ discord: state.discord });
}

export function deleteDiscord(now: number): Answer {
  if (!destinations(now).discord) return fail(404, "destination_not_configured", "No Discord webhook is set up for this server");
  state.discord = null;
  return ok({ deleted: true });
}

/** "Send test" in the demo: answers as if Discord took it, without any network call. */
export function testDiscord(now: number): Answer {
  const current = destinations(now).discord;
  if (!current) return fail(404, "destination_not_configured", "No Discord webhook is set up for this server");
  return ok({ ok: true });
}

export function setMute(now: number, body: unknown): Answer {
  const parsed = SetMuteRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", "That request isn't valid.");
  const until = Date.parse(parsed.data.until);
  if (until <= now || until > now + 7 * 24 * 60 * MIN) return fail(422, "mute_invalid", "Choose a time in the future, at most 7 days ahead");
  state.mutedUntil = iso(until);
  return ok({ mutedUntil: state.mutedUntil });
}

export function clearMute(): Answer {
  state.mutedUntil = null;
  return ok({ mutedUntil: null });
}

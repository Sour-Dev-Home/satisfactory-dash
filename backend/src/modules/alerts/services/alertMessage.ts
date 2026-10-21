import { ownValue } from "@satisfactory-dash/shared";
import type { RuleKind, Severity } from "./rules.js";

/**
 * ADR-0027 decision 5: the words of an alert, as a Discord webhook payload. Everything that came from the game (a
 * server's display name, a recipe, an item class name) is untrusted text: it is escaped so it cannot become a mention,
 * a link, a channel reference or markdown, cut to a sane length, and `allowed_mentions.parse` is empty as a second
 * guard, so even a missed escape can never ping anyone. No secret, URL or address is ever part of a message.
 */

export type MessageTransition = "fired" | "updated" | "renotify" | "resolved";

export interface AlertMessageInput {
  kind: RuleKind;
  transition: MessageTransition;
  severity: Severity;
  /** "circuit:3", "group" or "server". */
  subject: string;
  /** What the evaluator recorded (counts, top recipes and reasons, the circuit). Treated as untrusted in shape. */
  summary: Record<string, unknown>;
  serverName: string;
  /** ms epoch of the transition. */
  at: number;
}

export interface DiscordPayload {
  username: string;
  embeds: { title: string; description: string; color: number; timestamp: string; footer: { text: string } }[];
  allowed_mentions: { parse: never[] };
}

const MAX_FIELD = 120;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 1800;
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

const COLORS: Record<Severity | "resolved", number> = {
  critical: 0xe74c3c,
  warning: 0xf1c40f,
  info: 0x3498db,
  resolved: 0x2ecc71,
};

const MARKDOWN_CHARS = new Set(["\\", "`", "*", "_", "~", "|", ">", "#", "[", "]", "(", ")", "<", ":"]);

/** C0/C1 controls, zero-width and bidi characters, line/paragraph separators, word joiners, the BOM. */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/** A string or finite number as text, with controls, bidi overrides and invisible characters as spaces (by code point,
 *  so this file holds no invisible characters) and whitespace runs collapsed. Anything else is "". */
function visibleText(value: unknown): string {
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  let plain = "";
  for (const char of text) plain += isInvisible(char.codePointAt(0) ?? 0) ? " " : char;
  return plain.replace(/\s+/g, " ").trim();
}

/** A text sanitiser: untrusted value in, safe text of at most `max` characters out. */
type Sanitise = (value: unknown, max: number) => string;

/**
 * ADR-0044 (#348, 348-2): untrusted text made inert for a push notification, which a browser shows as PLAIN text (no
 * markdown, no mentions, no links rendered): the same cleaning as Discord's (controls, bidi and invisible characters
 * removed, whitespace collapsed, cut to `max`), without the markdown backslashes that would show up literally.
 */
export function plainAlertText(value: unknown, max = MAX_FIELD): string {
  const cleaned = visibleText(value);
  return cleaned.length <= max ? cleaned : `${cutAt(cleaned, Math.max(0, max - 1))}…`;
}

/** Untrusted text made inert for Discord: no control characters, no markdown, no mention, cut to `max` characters. */
export function escapeDiscordText(value: unknown, max = MAX_FIELD): string {
  const cleaned = visibleText(value);
  // Markdown, links and <@id> / <#id> / <:emoji:> references get a backslash; every @ gets a zero-width space, so
  // @everyone and @here are not mentions.
  let escaped = "";
  for (const char of cleaned) {
    if (MARKDOWN_CHARS.has(char)) escaped += `\\${char}`;
    else if (char === "@") escaped += `@${ZERO_WIDTH_SPACE}`;
    else escaped += char;
  }
  if (escaped.length <= max) return escaped;
  let cut = escaped.slice(0, Math.max(0, max - 1));
  // Never end on the first half of a surrogate pair (an emoji at the cut): JSON would carry a lone surrogate and
  // Discord can refuse the whole message for it.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  // Never end on the first half of an escape: an odd run of trailing backslashes would escape the ellipsis.
  const trailing = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (trailing % 2 === 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/** A non-negative finite rate, rounded to one decimal, as text; undefined when the value is not one. */
const rate = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(Math.round(value * 10) / 10) : undefined;

function listOf(value: unknown, keyField: string, clean: Sanitise, max = 5): { label: string; count: number }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const raw = record[keyField];
    const label = raw === null ? "no recipe" : clean(raw, 80);
    return [{ label: label.length > 0 ? label : "unknown", count: count(record.count) }];
  });
}

function machineTitle(transition: MessageTransition, machines: number): string {
  const noun = machines === 1 ? "1 machine" : `${machines} machines`;
  switch (transition) {
    case "fired":
      return `${noun} stopped`;
    case "updated":
      return `More machines stopped (${machines} now)`;
    case "renotify":
      return `Still stopped: ${noun}`;
    case "resolved":
      return "Machines running again";
  }
}

/** The title and the detail lines of one alert, by kind. Every game string goes through `clean` (Discord or plain). */
function words(input: AlertMessageInput, clean: Sanitise): { title: string; lines: string[] } {
  const circuit = count(input.summary.circuit);
  switch (input.kind) {
    case "power_outage":
    case "fuse_trip": {
      const what = input.kind === "fuse_trip" ? "Fuse tripped" : "Power outage";
      return {
        title:
          input.transition === "resolved"
            ? `Power restored: circuit ${circuit}`
            : input.transition === "renotify"
              ? `Still down: ${what.toLowerCase()} on circuit ${circuit}`
              : `${what}: circuit ${circuit}`,
        lines: [],
      };
    }
    case "server_unreachable": {
      const down = count(input.summary.downForSeconds);
      return {
        // FRM alone being down also raises this, so the words say "or FRM" (the architect's wording).
        title:
          input.transition === "resolved"
            ? "Game server and FRM responding again"
            : input.transition === "renotify"
              ? "Still not responding: game server or FRM"
              : "Game server or FRM not responding",
        lines: down > 0 && input.transition !== "resolved" ? [`No answer for about ${Math.max(1, Math.round(down / 60))} min.`] : [],
      };
    }
    case "agent_offline": {
      // ADR-0031: the edge agent on the game PC stopped reporting (the PC is off, the network is down, or the agent stopped).
      const silent = count(input.summary.silentForSeconds);
      return {
        title:
          input.transition === "resolved"
            ? "Agent reporting again"
            : input.transition === "renotify"
              ? "Still offline: the agent on the game PC"
              : "Agent offline: the game PC has stopped reporting",
        lines: silent > 0 && input.transition !== "resolved" ? [`No snapshot for about ${Math.max(1, Math.round(silent / 60))} min.`] : [],
      };
    }
    case "production_below_target": {
      // `item` is a game class name: escaped like any game text. The rates are rounded to one decimal.
      const item = clean(input.summary.item, 80) || "an item";
      const lines: string[] = [];
      if (input.transition !== "resolved") {
        const target = rate(input.summary.targetPerMinute);
        const average = rate(input.summary.averagePerMinute);
        const minutes = count(input.summary.windowMinutes);
        if (target !== undefined && average !== undefined) {
          lines.push(`Making ${average}/min, target ${target}/min${minutes > 0 ? ` (average over ${minutes} min)` : ""}.`);
        }
      }
      return {
        title:
          input.transition === "resolved"
            ? `Production back on target: ${item}`
            : input.transition === "renotify"
              ? `Still below target: ${item}`
              : `Production below target: ${item}`,
        lines,
      };
    }
    case "stopped_machines": {
      const machines = count(input.summary.machines);
      const lines: string[] = [];
      if (input.transition !== "resolved") {
        const reasons = listOf(input.summary.byReason, "reason", clean);
        if (reasons.length > 0) lines.push(reasons.map((r) => `${r.count} × ${r.label}`).join(" · "));
        const recipes = listOf(input.summary.byRecipe, "recipe", clean);
        if (recipes.length > 0) lines.push(`Making: ${recipes.map((r) => `${r.label} ×${r.count}`).join(", ")}`);
        const added = count(input.summary.newMachines);
        if (input.transition === "updated" && added > 0) lines.push(`${added} new since the last message.`);
      }
      return { title: machineTitle(input.transition, machines), lines };
    }
  }
}

/** Cuts to at most `max` UTF-16 units without leaving the first half of a surrogate pair at the end. */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** ADR-0044 decision 7: the push plaintext stays at or under 3 KB until each push service's cap is verified. */
export const MAX_PUSH_PAYLOAD_BYTES = 3072;
const MAX_PUSH_BODY = 1000;

/**
 * The JSON a push notification carries (the service worker in 348-3 shows `title` and `body`). Built from the SAME words
 * and the SAME fields as the Discord message (#348, the ADR-0045 B10 comment): the title, the server's display name and
 * the detail lines, each game string cleaned by `plainAlertText`. Nothing else from the game: the rest are our own
 * codes (kind, transition, severity), the server's public id and the time. At most MAX_PUSH_PAYLOAD_BYTES of UTF-8.
 */
export interface PushPayload {
  v: 1;
  title: string;
  body: string;
  serverId: string;
  kind: string;
  transition: string;
  severity: string;
  at: string;
}

export function formatPushMessage(input: AlertMessageInput & { serverPublicId: string }): Buffer {
  const { title, lines } = words(input, plainAlertText);
  const server = plainAlertText(input.serverName, 60) || "server";
  const at = Number.isFinite(input.at) ? new Date(input.at) : new Date(0);
  let body = cutAt([server, ...lines].join("\n"), MAX_PUSH_BODY);
  const encode = (): Buffer => {
    const payload: PushPayload = {
      v: 1,
      title: cutAt(title, MAX_TITLE),
      body,
      serverId: input.serverPublicId,
      kind: input.kind,
      transition: input.transition,
      severity: input.severity,
      at: at.toISOString(),
    };
    return Buffer.from(JSON.stringify(payload), "utf8");
  };
  let bytes = encode();
  // Multi-byte text (or JSON escapes) can push it over: shorten the body until it fits.
  while (bytes.length > MAX_PUSH_PAYLOAD_BYTES && body.length > 0) {
    body = cutAt(body, Math.max(0, body.length - 100));
    bytes = encode();
  }
  return bytes;
}

/** The test notification (POST /api/push/subscriptions/:id/test): fixed words, no game text at all. */
export function formatPushTestMessage(nowMs: number): Buffer {
  return Buffer.from(
    JSON.stringify({ v: 1, title: "Test notification", body: "Push notifications are set up on this device.", kind: "test", at: new Date(nowMs).toISOString() }),
    "utf8",
  );
}

export function formatAlertMessage(input: AlertMessageInput): DiscordPayload {
  const { title, lines } = words(input, escapeDiscordText);
  const server = escapeDiscordText(input.serverName, 60) || "server";
  const description = cutAt([`**${server}**`, ...lines].join("\n"), MAX_DESCRIPTION);
  const at = Number.isFinite(input.at) ? new Date(input.at) : new Date(0);
  return {
    username: "Satisfactory Dash",
    embeds: [
      {
        title: cutAt(title, MAX_TITLE),
        description,
        color: input.transition === "resolved" ? COLORS.resolved : (ownValue(COLORS, input.severity) ?? COLORS.info),
        timestamp: at.toISOString(),
        footer: { text: `${input.kind.replace(/_/g, " ")} · ${input.severity}` },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

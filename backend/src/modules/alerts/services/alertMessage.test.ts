import { describe, expect, it } from "vitest";
import { escapeDiscordText, formatAlertMessage, type AlertMessageInput } from "./alertMessage.js";

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);
const base = (over: Partial<AlertMessageInput> = {}): AlertMessageInput => ({
  kind: "power_outage",
  transition: "fired",
  severity: "critical",
  subject: "circuit:3",
  summary: { circuit: 3 },
  serverName: "Home",
  at: AT,
  ...over,
});
const embed = (input: AlertMessageInput) => formatAlertMessage(input).embeds[0]!;

describe("formatAlertMessage: the words per kind and transition", () => {
  it("power outage: fired, still down, restored", () => {
    expect(embed(base()).title).toBe("Power outage: circuit 3");
    expect(embed(base({ transition: "renotify" })).title).toBe("Still down: power outage on circuit 3");
    expect(embed(base({ transition: "resolved" })).title).toBe("Power restored: circuit 3");
  });

  it("fuse trip", () => {
    expect(embed(base({ kind: "fuse_trip" })).title).toBe("Fuse tripped: circuit 3");
  });

  it('server unreachable says "Game server or FRM not responding" (it also fires when only FRM is down)', () => {
    const input = base({ kind: "server_unreachable", subject: "server", summary: { failedPolls: 30, downForSeconds: 150 } });
    expect(embed(input).title).toBe("Game server or FRM not responding");
    expect(embed(input).description).toContain("about 3 min");
    expect(embed({ ...input, transition: "renotify" }).title).toBe("Still not responding: game server or FRM");
    expect(embed({ ...input, transition: "resolved" }).title).toBe("Game server and FRM responding again");
    expect(embed({ ...input, transition: "resolved" }).description).not.toContain("min");
  });

  it("stopped machines: counts, reasons and recipes, and the updated/renotify/resolved wording", () => {
    const summary = {
      machines: 4,
      byRecipe: [{ recipe: "Iron Plate", count: 3 }, { recipe: null, count: 1 }],
      byReason: [{ reason: "output full", count: 3 }, { reason: "input short: Desc_Screw_C", count: 1 }],
    };
    const input = base({ kind: "stopped_machines", subject: "group", severity: "warning", summary });
    const fired = embed(input);
    expect(fired.title).toBe("4 machines stopped");
    expect(fired.description).toContain("3 × output full");
    expect(fired.description).toContain("1 × input short\\: Desc\\_Screw\\_C");
    expect(fired.description).toContain("Iron Plate ×3, no recipe ×1");
    expect(embed({ ...input, transition: "updated", summary: { ...summary, machines: 6, newMachines: 2 } }).title).toBe("More machines stopped (6 now)");
    expect(embed({ ...input, transition: "updated", summary: { ...summary, newMachines: 2 } }).description).toContain("2 new since the last message.");
    expect(embed({ ...input, transition: "renotify" }).title).toBe("Still stopped: 4 machines");
    expect(embed({ ...input, transition: "resolved" }).title).toBe("Machines running again");
    expect(embed({ ...input, summary: { machines: 1 } }).title).toBe("1 machine stopped");
  });

  it("colours by severity, and green for a resolve; carries the time and the kind", () => {
    expect(embed(base()).color).toBe(0xe74c3c);
    expect(embed(base({ severity: "warning" })).color).toBe(0xf1c40f);
    expect(embed(base({ severity: "info" })).color).toBe(0x3498db);
    expect(embed(base({ transition: "resolved" })).color).toBe(0x2ecc71);
    expect(embed(base()).timestamp).toBe("2026-09-26T12:00:00.000Z");
    expect(embed(base()).footer.text).toBe("power outage · critical");
  });

  it("can never ping: allowed_mentions.parse is empty on every message", () => {
    for (const kind of ["power_outage", "fuse_trip", "server_unreachable", "stopped_machines"] as const) {
      expect(formatAlertMessage(base({ kind, serverName: "@everyone <@123>" })).allowed_mentions).toEqual({ parse: [] });
    }
  });
});

describe("escapeDiscordText: game text made inert", () => {
  it("neutralises mentions, references, links and markdown", () => {
    const out = escapeDiscordText("@everyone @here <@123456789> <#987654321> <:emoji:111> [click](https://evil.example) **bold** `code` ~~x~~ __u__ ||spoiler|| > quote # head");
    expect(out).not.toMatch(/@(?!​)/); // every @ is followed by a zero-width space
    expect(out).not.toMatch(/(^|[^\\])[<>*_`~|#[\]():]/); // every special character is escaped
  });

  it("removes control, bidi and invisible characters and collapses whitespace", () => {
    expect(escapeDiscordText("a\u0000b‮c​d\n\n  e\tf⁦g")).toBe("a b c d e f g");
  });

  it("cuts to the maximum with an ellipsis, and never leaves a dangling half of an escape", () => {
    const out = escapeDiscordText("x".repeat(500), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
    for (const text of ["_".repeat(50), "*".repeat(50), "@".repeat(50)]) {
      expect(escapeDiscordText(text, 30).length).toBeLessThanOrEqual(30);
    }
  });

  it("turns anything that is not text or a finite number into an empty string", () => {
    for (const value of [undefined, null, {}, [], true, Number.NaN, Infinity]) expect(escapeDiscordText(value)).toBe("");
    expect(escapeDiscordText(42)).toBe("42");
  });
});

describe("untrusted names never break out of the message", () => {
  const hostile = "@everyone <@1> [x](http://evil) `\n**";
  it("a hostile server name and recipe", () => {
    const payload = formatAlertMessage(
      base({ kind: "stopped_machines", subject: "group", serverName: hostile, summary: { machines: 1, byRecipe: [{ recipe: hostile, count: 1 }], byReason: [{ reason: hostile, count: 1 }] } }),
    );
    const text = JSON.stringify(payload);
    expect(text).not.toContain("@everyone");
    expect(text).not.toContain("<@1>");
    expect(text).not.toContain("](http");
    expect(payload.allowed_mentions.parse).toEqual([]);
  });

  it("bounds the size: a huge name and a huge list stay inside Discord's limits", () => {
    const payload = formatAlertMessage(
      base({
        kind: "stopped_machines",
        serverName: "n".repeat(5000),
        summary: { machines: 9999, byRecipe: Array.from({ length: 200 }, (_, i) => ({ recipe: "r".repeat(400) + i, count: i })), byReason: Array.from({ length: 200 }, () => ({ reason: "x".repeat(400), count: 1 })) },
      }),
    );
    const e = payload.embeds[0]!;
    expect(e.title.length).toBeLessThanOrEqual(256);
    expect(e.description.length).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(payload).length).toBeLessThan(6000);
  });

  it("a malformed summary (wrong types) still produces a message, never a throw", () => {
    for (const summary of [{}, { machines: "many" }, { machines: -1, byRecipe: "x", byReason: 5 }, { byRecipe: [null, 3, "x", { recipe: {} }], byReason: [{}] }, { circuit: "3" }]) {
      for (const kind of ["power_outage", "server_unreachable", "stopped_machines"] as const) {
        expect(() => formatAlertMessage(base({ kind, summary: summary as Record<string, unknown> }))).not.toThrow();
      }
    }
    expect(() => formatAlertMessage(base({ at: Number.NaN }))).not.toThrow();
  });

  it("never contains a URL, an address or a token, even for a summary that tries to carry one", () => {
    const sneaky = formatAlertMessage(base({ summary: { circuit: 3, webhook: "https://discord.com/api/webhooks/1/abc", ip: "10.0.0.5", token: "s3cret" } }));
    const text = JSON.stringify(sneaky);
    expect(text).not.toContain("webhooks");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("s3cret");
  });
});

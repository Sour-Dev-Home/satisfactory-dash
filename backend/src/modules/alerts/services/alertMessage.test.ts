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

  it("production below target: the item, the average against the target, and the renotify/resolved wording", () => {
    const summary = { item: "Desc_IronPlate_C", targetPerMinute: 120, averagePerMinute: 87.46, windowMinutes: 10 };
    const input = base({ kind: "production_below_target", subject: "item", severity: "warning", summary });
    const fired = embed(input);
    expect(fired.title).toBe("Production below target: Desc\\_IronPlate\\_C");
    expect(fired.description).toContain("Making 87.5/min, target 120/min (average over 10 min).");
    expect(embed({ ...input, transition: "renotify" }).title).toBe("Still below target: Desc\\_IronPlate\\_C");
    const resolved = embed({ ...input, transition: "resolved" });
    expect(resolved.title).toBe("Production back on target: Desc\\_IronPlate\\_C");
    expect(resolved.description).not.toContain("Making");
  });

  it("production below target: the item is escaped like any game text, and a missing or bad number just drops the line", () => {
    const evil = embed(base({ kind: "production_below_target", subject: "item", summary: { item: "@everyone <@123> **x**", targetPerMinute: 10, averagePerMinute: 1, windowMinutes: 10 } }));
    expect(evil.title).not.toMatch(/@(?!​)/);
    expect(evil.title).not.toMatch(/(^|[^\\])[<>*]/); // every special character is escaped
    const noAverage = embed(base({ kind: "production_below_target", subject: "item", summary: { item: "Desc_X_C", targetPerMinute: 10, windowMinutes: 10 } }));
    expect(noAverage.description).not.toContain("Making");
    for (const bad of [Number.NaN, -1, "5", null, Number.POSITIVE_INFINITY]) {
      const out = embed(base({ kind: "production_below_target", subject: "item", summary: { item: "Desc_X_C", targetPerMinute: 10, averagePerMinute: bad, windowMinutes: 10 } }));
      expect(out.description, String(bad)).not.toContain("Making");
    }
    expect(embed(base({ kind: "production_below_target", subject: "item", summary: {} })).title).toBe("Production below target: an item");
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
    for (const kind of ["power_outage", "fuse_trip", "server_unreachable", "stopped_machines", "production_below_target"] as const) {
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

// Added by the fresh-eyes pass. The first "neutralises" test above only ever inspects the first 120 characters of its
// (longer) input, so it never reached `~ _ | > #` or the backslash: these check every character on its own.
/** No lone surrogate (String.prototype.isWellFormed is newer than this project's TS lib). */
const wellFormed = (text: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

describe("escapeDiscordText: every special character, one at a time", () => {
  it.each(["\\", "`", "*", "_", "~", "|", ">", "#", "[", "]", "(", ")", "<", ":"])("escapes %s with a backslash (and a backslash itself)", (char) => {
    expect(escapeDiscordText(`a${char}b`)).toBe(`a\\${char}b`);
  });

  it("puts a zero-width space after every @, so no mention can form", () => {
    expect(escapeDiscordText("@everyone@here")).toBe("@​everyone@​here");
  });

  it("a user backslash cannot cancel the escape of the character after it", () => {
    // `\*x*` must not come out as `\\*x\*`-style text where the second star is live markdown.
    expect(escapeDiscordText("\\*x*")).toBe("\\\\\\*x\\*");
  });

  it.each([
    ["DEL", "\u007f"],
    ["a C1 control", "\u0085"],
    ["the BOM", "﻿"],
    ["a zero-width joiner", "‍"],
    ["the line separator", " "],
    ["a word joiner", "⁠"],
    ["a bidi isolate", "⁩"],
  ])("turns %s into a space", (_name, char) => {
    expect(escapeDiscordText(`a${char}b`)).toBe("a b");
  });

  it("does not cut text that is exactly the maximum, and counts the escapes it added toward the maximum", () => {
    expect(escapeDiscordText("x".repeat(20), 20)).toBe("x".repeat(20));
    expect(escapeDiscordText("*".repeat(10), 20)).toBe("\\*".repeat(10));
    const cut = escapeDiscordText("*".repeat(11), 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("an even run of backslashes at the cut is kept, an odd one is shortened by one", () => {
    expect(escapeDiscordText("\\".repeat(50), 31)).toBe(`${"\\\\".repeat(15)}…`); // 30 characters cut: 15 escaped pairs
    expect(escapeDiscordText("\\".repeat(50), 30)).toBe(`${"\\\\".repeat(14)}…`); // 29 cut: the odd one is dropped
  });

  it("never leaves half of a surrogate pair before the ellipsis (an emoji at the cut)", () => {
    const out = escapeDiscordText("😀".repeat(50), 20);
    expect(wellFormed(out)).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    for (let max = 3; max < 12; max += 1) expect(wellFormed(escapeDiscordText(`ab${"😀".repeat(20)}`, max)), String(max)).toBe(true);
  });
});

describe("formatAlertMessage: limits and edge wording (added by the fresh-eyes pass)", () => {
  const machines = (summary: Record<string, unknown>, over: Partial<AlertMessageInput> = {}) => embed(base({ kind: "stopped_machines", subject: "group", severity: "warning", summary, ...over }));

  it("cuts a server name at 60 characters and a recipe or reason at 80", () => {
    expect(embed(base({ serverName: "n".repeat(61) })).description).toBe(`**${"n".repeat(59)}…**`);
    const e = machines({ machines: 1, byRecipe: [{ recipe: "r".repeat(81), count: 1 }], byReason: [{ reason: "q".repeat(81), count: 1 }] });
    expect(e.description).toContain(`${"r".repeat(79)}… ×1`);
    expect(e.description).toContain(`1 × ${"q".repeat(79)}…`);
  });

  it("falls back to `server` for an empty name and `unknown` for an empty or missing recipe", () => {
    expect(embed(base({ serverName: "" })).description).toBe("**server**");
    expect(embed(base({ serverName: "​\u0000" })).description).toBe("**server**");
    const e = machines({ machines: 2, byRecipe: [{ recipe: "", count: 1 }, { count: 1 }, { recipe: {}, count: 1 }] });
    expect(e.description).toContain("Making: unknown ×1, unknown ×1, unknown ×1");
  });

  it("lists at most 5 recipes and 5 reasons", () => {
    const list = (key: string) => Array.from({ length: 8 }, (_, i) => ({ [key]: `item${i}`, count: 1 }));
    const e = machines({ machines: 8, byRecipe: list("recipe"), byReason: list("reason") });
    expect(e.description).toContain("item4");
    expect(e.description).not.toContain("item5");
  });

  it("treats a negative, fractional or non-numeric count as 0", () => {
    expect(machines({ machines: -1 }).title).toBe("0 machines stopped");
    expect(machines({ machines: 2.5 }).title).toBe("0 machines stopped");
    expect(machines({ machines: "3" }).title).toBe("0 machines stopped");
    expect(embed(base({ summary: { circuit: -2 } })).title).toBe("Power outage: circuit 0");
  });

  it("says how long the server has been silent, at least 1 minute, rounded to the nearest minute", () => {
    const unreachable = (downForSeconds: number, transition: AlertMessageInput["transition"] = "fired") =>
      embed(base({ kind: "server_unreachable", subject: "server", transition, summary: { downForSeconds } }));
    expect(unreachable(20).description).toContain("about 1 min.");
    expect(unreachable(100).description).toContain("about 2 min.");
    expect(unreachable(0).description).toBe("**Home**");
    expect(unreachable(600, "renotify").description).toContain("about 10 min.");
    expect(unreachable(600, "resolved").description).toBe("**Home**");
  });

  it("only an `updated` message says how many machines are new; a resolve lists no reasons or recipes", () => {
    const summary = { machines: 4, newMachines: 2, byRecipe: [{ recipe: "Iron Plate", count: 4 }], byReason: [{ reason: "output full", count: 4 }] };
    expect(machines(summary, { transition: "fired" }).description).not.toContain("new since");
    expect(machines(summary, { transition: "renotify" }).description).not.toContain("new since");
    expect(machines(summary, { transition: "updated" }).description).toContain("2 new since the last message.");
    expect(machines(summary, { transition: "updated", summary: { ...summary, newMachines: 0 } }).description).not.toContain("new since");
    expect(machines(summary, { transition: "resolved" }).description).toBe("**Home**");
  });

  it("a resolved alert is green whatever its severity, and the fuse trip wording differs from the outage", () => {
    expect(embed(base({ transition: "resolved", severity: "info" })).color).toBe(0x2ecc71);
    expect(embed(base({ kind: "fuse_trip", transition: "renotify" })).title).toBe("Still down: fuse tripped on circuit 3");
    expect(embed(base({ kind: "fuse_trip", transition: "resolved" })).title).toBe("Power restored: circuit 3");
    expect(embed(base({ kind: "fuse_trip" })).footer.text).toBe("fuse trip · critical");
  });

  it("a non-finite time becomes the epoch instead of throwing", () => {
    expect(embed(base({ at: Number.NaN })).timestamp).toBe("1970-01-01T00:00:00.000Z");
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

import { describe, expect, it } from "vitest";
import { formatAlertMessage, formatPushMessage, formatPushTestMessage, MAX_PUSH_PAYLOAD_BYTES, plainAlertText, type AlertMessageInput } from "./alertMessage.js";

// ADR-0044 (#348, 348-2): the push payload uses the Discord message's words and fields, cleaned as plain text.
const AT = Date.UTC(2026, 9, 20, 12, 0, 0);
const base = (over: Partial<AlertMessageInput> = {}): AlertMessageInput & { serverPublicId: string } => ({
  kind: "power_outage",
  transition: "fired",
  severity: "critical",
  subject: "circuit:3",
  summary: { circuit: 3 },
  serverName: "Home",
  at: AT,
  serverPublicId: "alpha",
  ...over,
});
const parse = (bytes: Buffer) => JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
const cp = (n: number) => String.fromCodePoint(n);

describe("formatPushMessage", () => {
  it("carries the same title as the Discord message, the server name and our own codes only", () => {
    const input = base();
    const push = parse(formatPushMessage(input));
    expect(push).toEqual({
      v: 1,
      title: formatAlertMessage(input).embeds[0]!.title,
      body: "Home",
      serverId: "alpha",
      kind: "power_outage",
      transition: "fired",
      severity: "critical",
      at: new Date(AT).toISOString(),
    });
  });

  it("cleans game text as plain text: no controls, bidi overrides or invisible characters, and no markdown escapes", () => {
    const push = parse(
      formatPushMessage(
        base({
          kind: "stopped_machines",
          serverName: `Base${cp(0x202e)}one${cp(0x200b)}\n*two*`,
          summary: { machines: 2, byRecipe: [{ recipe: `Iron_Plate${cp(0x0007)}`, count: 2 }], byReason: [{ reason: "no_power", count: 2 }] },
        }),
      ),
    );
    expect(push.body).toBe("Base one *two*\n2 × no_power\nMaking: Iron_Plate ×2");
    const body = push.body as string;
    for (const bad of [cp(0x202e), cp(0x200b), cp(0x0007), "\\"]) expect(body.includes(bad)).toBe(false);
    expect(body).toContain("Iron_Plate"); // not escaped to Iron\_Plate
    expect(body).toContain("*two*");
  });

  it("a summary cannot add fields: an unknown key never reaches the payload", () => {
    const text = formatPushMessage(base({ summary: { circuit: 3, webhook: "https://x.example/hook", token: "s3cret" } })).toString();
    expect(text).not.toContain("x.example");
    expect(text).not.toContain("s3cret");
  });

  it("stays within the 3 KB plaintext cap even for huge multi-byte game text", () => {
    const huge = base({
      kind: "stopped_machines",
      serverName: "名".repeat(5000),
      summary: { machines: 9, byRecipe: Array.from({ length: 50 }, (_, i) => ({ recipe: `${"鉄".repeat(400)}${i}`, count: i })), byReason: [{ reason: "😀".repeat(400), count: 1 }] },
    });
    const bytes = formatPushMessage(huge);
    expect(bytes.length).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(() => parse(bytes)).not.toThrow();
    expect((parse(bytes).body as string).startsWith("名")).toBe(true);
  });

  it("never ends on half a surrogate pair when cutting", () => {
    const cut = plainAlertText("😀".repeat(100), 10);
    expect(cut.endsWith("…")).toBe(true);
    const beforeEllipsis = cut.charCodeAt(cut.length - 2);
    expect(beforeEllipsis >= 0xd800 && beforeEllipsis <= 0xdbff).toBe(false);
  });
});

describe("formatPushTestMessage", () => {
  it("is fixed words and a time, nothing from a server", () => {
    expect(parse(formatPushTestMessage(AT))).toEqual({ v: 1, title: "Test notification", body: "Push notifications are set up on this device.", kind: "test", at: new Date(AT).toISOString() });
  });
});

describe("plainAlertText (hunt)", () => {
  it("never leaves half a surrogate pair at any cut length, ellipsis included", async () => {
    const { plainAlertText } = await import("./alertMessage.js");
    const text = "a".repeat(3) + "\u{1F600}".repeat(10);
    for (let max = 0; max <= 20; max += 1) {
      const out = plainAlertText(text, max);
      expect(out.isWellFormed(), `max ${max}`).toBe(true);
      expect(out.length, `max ${max}`).toBeLessThanOrEqual(Math.max(max, 1));
    }
  });
});

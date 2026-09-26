import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileLogger } from "./logger.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sd-agent-log-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-26T12:00:00.000Z");
const lines = (file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
const allText = () => readdirSync(dir).map((file) => readFileSync(path.join(dir, file), "utf8")).join("\n");

describe("what may appear in a line", () => {
  it("writes JSON lines with the time, level, event and only plain fields", () => {
    const log = createFileLogger({ dir, now: () => T0 });
    log.info("push_ok", { status: 200, queued: 3, commandsPending: true, cadence: 5, agentVersion: "0.1.0", code: "upstream_unreachable" });
    expect(lines("agent-2026-09-26.log")).toEqual([
      { t: "2026-09-26T12:00:00.000Z", level: "info", event: "push_ok", status: 200, queued: 3, commandsPending: true, cadence: 5, agentVersion: "0.1.0", code: "upstream_unreachable" },
    ]);
  });

  it("never writes a player name, a body, or any free text: those values become [redacted]", () => {
    const log = createFileLogger({ dir, now: () => T0 });
    const body = JSON.stringify({ players: [{ name: "Alice the Builder", online: true }] });
    log.warn("snapshot_dropped", { playerName: "Alice the Builder", body, message: "connect ECONNREFUSED 10.0.0.5:7777", note: "has\nnewline", empty: "" });
    const text = allText();
    for (const leaked of ["Alice", "Builder", "ECONNREFUSED", "10.0.0.5", "players", "newline"]) expect(text, leaked).not.toContain(leaked);
    expect(lines("agent-2026-09-26.log")[0]).toMatchObject({ playerName: "[redacted]", body: "[redacted]", message: "[redacted]", note: "[redacted]", empty: "[redacted]" });
  });

  it("objects, arrays and functions cannot be logged; NaN and Infinity become null", () => {
    const log = createFileLogger({ dir, now: () => T0 });
    log.info("odd", { obj: { a: "secret" } as never, arr: ["x"] as never, fn: (() => "x") as never, nan: Number.NaN, inf: Number.POSITIVE_INFINITY, missing: undefined, nothing: null });
    const [line] = lines("agent-2026-09-26.log");
    expect(line).toMatchObject({ obj: "[redacted]", arr: "[redacted]", fn: "[redacted]", nan: null, inf: null, missing: null, nothing: null });
    expect(allText()).not.toContain("secret");
  });

  it("a bad event name is replaced, a bad field name is dropped, and a field cannot overwrite the envelope", () => {
    const log = createFileLogger({ dir, now: () => T0 });
    log.info("Bad Event With Spaces And A Token abc123");
    log.info("ok_event", { "bad key!": 1, ["x".repeat(40)]: 2, t: "forged", level: "forged", event: "forged", fine: 3 });
    const written = lines("agent-2026-09-26.log");
    expect(written[0]).toMatchObject({ event: "invalid_event" });
    expect(Object.keys(written[1]!).sort()).toEqual(["event", "fine", "level", "t"]);
    expect(written[1]).toMatchObject({ event: "ok_event", level: "info", t: "2026-09-26T12:00:00.000Z", fine: 3 });
  });

  it("a registered secret is scrubbed from any line, even one that slips through as a code", () => {
    const log = createFileLogger({ dir, now: () => T0 });
    const secret = "tok_Zm9vYmFyLXNlY3JldC12YWx1ZQ";
    log.addSecret(secret);
    log.addSecret("abc"); // too short to register: it would blank out ordinary words
    log.error("auth_failed", { hint: secret, code: `x-${secret}-y` });
    expect(allText()).not.toContain(secret);
    expect(allText()).toContain("[redacted]");
    log.info("plain", { word: "abc" });
    expect(lines("agent-2026-09-26.log").at(-1)).toMatchObject({ word: "abc" });
  });

  it("the echo callback gets the same scrubbed line", () => {
    const echoed: string[] = [];
    const log = createFileLogger({ dir, now: () => T0, echo: (line) => echoed.push(line) });
    log.addSecret("supersecretvalue");
    log.info("hello", { v: "supersecretvalue" });
    expect(echoed).toHaveLength(1);
    expect(echoed[0]).not.toContain("supersecretvalue");
  });
});

describe("rotation (7 days) and the size cap", () => {
  it("writes one file per UTC day and deletes those older than seven days, leaving other files alone", () => {
    let now = T0 - 10 * DAY;
    const log = createFileLogger({ dir, now: () => now });
    for (let day = 0; day <= 10; day++) {
      now = T0 - (10 - day) * DAY;
      log.info("tick");
    }
    writeFileSync(path.join(dir, "store.json"), "{}");
    writeFileSync(path.join(dir, "agent-notes.txt"), "keep");
    now = T0 + DAY; // a new day triggers the pass
    log.info("tick");
    const files = readdirSync(dir).sort();
    expect(files).toContain("store.json");
    expect(files).toContain("agent-notes.txt");
    const days = files.filter((name) => name.startsWith("agent-2")).map((name) => name.slice(6, 16));
    expect(days).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].slice(1));
    expect(days).toHaveLength(7);
  });

  it("a day's file stops growing at the cap, with one note, and the next day starts fresh", () => {
    let now = T0;
    const log = createFileLogger({ dir, now: () => now, maxBytesPerDay: 600 });
    for (let i = 0; i < 100; i++) log.info("spam", { n: i });
    const first = readFileSync(path.join(dir, "agent-2026-09-26.log"), "utf8");
    expect(first.length).toBeLessThanOrEqual(600 + 100);
    expect(first.match(/log_size_cap/g)).toHaveLength(1);
    now = T0 + DAY;
    log.info("fresh");
    expect(lines("agent-2026-09-27.log")).toHaveLength(1);
  });

  it("a log that cannot be written never throws into the agent", () => {
    const log = createFileLogger({ dir: path.join(dir, "store.json", "cannot-be-a-dir"), now: () => T0 });
    writeFileSync(path.join(dir, "store.json"), "{}");
    expect(() => log.info("still_fine")).not.toThrow();
  });
});

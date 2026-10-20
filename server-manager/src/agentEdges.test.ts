import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAgentHalted } from "./agentHalted";
import { tailAgentLog } from "./agentLog";
import { readAgentTask, startAgentTask, type RunFn } from "./agentTask";
import { logDelta, logLineParts } from "./renderer/agentView";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-edges-"));
  mkdirSync(join(dir, "logs"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const log = (day: string, text: string) => writeFileSync(join(dir, "logs", `agent-${day}.log`), text);
const fake = (r: { code?: number | null; stdout?: string }): RunFn => async () => ({ code: 0, stdout: "", stderr: "", ...r });

describe("tailAgentLog edges", () => {
  it("handles CRLF with a trailing partial line", async () => {
    log("2026-10-20", "a\r\nb\r\nc");
    expect(await tailAgentLog(dir, 20)).toEqual(["a", "b"]);
  });
  it("keeps multi-byte characters intact when the read starts mid-file", async () => {
    const big = "é".repeat(40_000) + "\n" + "ok\n";
    log("2026-10-20", big);
    expect(await tailAgentLog(dir, 20)).toEqual(["ok"]);
  });
  it("a day's file that is a directory yields nothing, not a throw", async () => {
    mkdirSync(join(dir, "logs", "agent-2026-10-21.log"));
    await expect(tailAgentLog(dir, 20)).resolves.toEqual([]);
  });
  it("a fractional count gives nothing", async () => {
    log("2026-10-20", "a\n");
    expect(await tailAgentLog(dir, 1.5)).toEqual([]);
  });
});

describe("readAgentHalted edges", () => {
  const halted = (text: string) => writeFileSync(join(dir, "halted.json"), text);
  it.each(["", "{", "null", "[]", '"x"', '{"reason":"store_unreadable"}', '{"reason":"x","at":"t"}', '{"reason":"store_unreadable","at":5}'])(
    "treats %j as absent",
    (text) => {
      halted(text);
      expect(readAgentHalted(dir)).toBeUndefined();
    },
  );
  it("is absent when halted.json is a directory", () => {
    mkdirSync(join(dir, "halted.json"));
    expect(readAgentHalted(dir)).toBeUndefined();
  });
});

describe("agentTask edges", () => {
  it.each(["", "Unknown", "ready", "Ready\nRunning", "WARNING: x\nReady"])("rejects odd output %j", async (stdout) => {
    await expect(readAgentTask(fake({ stdout }))).rejects.toThrow();
  });
  it("rejects a non-zero exit even when stdout looks like a state", async () => {
    await expect(readAgentTask(fake({ code: 1, stdout: "Ready" }))).rejects.toThrow();
    await expect(readAgentTask(fake({ code: null, stdout: "Ready" }))).rejects.toThrow();
  });
  it("start rejects on a signal-ended run", async () => {
    await expect(startAgentTask(fake({ code: null }))).rejects.toThrow();
  });
});

describe("view edges", () => {
  it("logLineParts shows non-object JSON whole", () => {
    for (const l of ["null", "[1]", "42", "{bad"]) expect(logLineParts(l).detail).toBe(l);
  });
  it("logDelta replaces everything on a new day and adds only new lines when sliding", () => {
    expect(logDelta(["a", "b"], ["c"])).toEqual({ drop: 2, add: ["c"] });
    expect(logDelta(["a", "b"], ["b", "c"])).toEqual({ drop: 1, add: ["c"] });
    expect(logDelta([], ["a"])).toEqual({ drop: 0, add: ["a"] });
    expect(logDelta(["a"], [])).toEqual({ drop: 1, add: [] });
  });
});

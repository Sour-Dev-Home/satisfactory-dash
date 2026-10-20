import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAgentHalted } from "./agentHalted";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sm-halted-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const write = (text: string) => writeFileSync(join(dataDir, "halted.json"), text);

describe("readAgentHalted", () => {
  it("is undefined while the agent isn't halted", () => {
    expect(readAgentHalted(dataDir)).toBeUndefined();
    expect(readAgentHalted(join(dataDir, "missing"))).toBeUndefined();
  });

  it.each(["credential_rejected", "store_unreadable"] as const)("reads the %s marker the agent writes", (reason) => {
    write(`${JSON.stringify({ reason, at: "2026-10-20T10:00:00.000Z" })}\n`);
    expect(readAgentHalted(dataDir)).toEqual({ reason, at: "2026-10-20T10:00:00.000Z" });
  });

  it("treats a marker the agent didn't write as absent, as the agent does", () => {
    for (const text of ["{", "null", "[]", JSON.stringify({ reason: "other", at: "x" }), JSON.stringify({ reason: "store_unreadable" })]) {
      write(text);
      expect(readAgentHalted(dataDir)).toBeUndefined();
    }
  });

  it("keeps only the reason and a short time, never anything else in the file", () => {
    write(JSON.stringify({ reason: "store_unreadable", at: `2026-10-20T10:00:00.000Z${"x".repeat(100)}`, extra: "y" }));
    const halted = readAgentHalted(dataDir);
    expect(Object.keys(halted ?? {}).sort()).toEqual(["at", "reason"]);
    expect(halted?.at).toHaveLength(40);
  });
});

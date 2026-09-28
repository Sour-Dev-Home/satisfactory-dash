import { describe, expect, it } from "vitest";
import { ownValue } from "../src/index";

const STATE_LABEL: Record<string, string> = { running: "Running", stopped: "Stopped" };

describe("ownValue", () => {
  it("returns a table's own value", () => {
    expect(ownValue(STATE_LABEL, "running")).toBe("Running");
  });

  it("returns undefined for a missing key, so the caller's fallback applies", () => {
    expect(ownValue(STATE_LABEL, "paused") ?? "Unknown").toBe("Unknown");
  });

  it("never returns an inherited member (#361, #367)", () => {
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(ownValue(STATE_LABEL, name)).toBeUndefined();
    }
  });

  it("returns an own __proto__ key's value, as JSON.parse can create one", () => {
    const table = JSON.parse('{"__proto__": "own"}') as Record<string, string>;
    expect(ownValue(table, "__proto__")).toBe("own");
  });

  it("returns own falsy values as they are", () => {
    const table: Record<string, number | null> = { zero: 0, none: null };
    expect(ownValue(table, "zero")).toBe(0);
    expect(ownValue(table, "none")).toBeNull();
  });

  it("works on an object with no prototype", () => {
    const table = Object.assign(Object.create(null) as Record<string, string>, { a: "A" });
    expect(ownValue(table, "a")).toBe("A");
    expect(ownValue(table, "toString")).toBeUndefined();
  });

  it("keeps the value type, so a typed fallback compiles", () => {
    const COLOR = { ok: "green", bad: "red" } as const;
    const color: "green" | "red" | "muted" = ownValue(COLOR, "unknown") ?? "muted";
    expect(color).toBe("muted");
  });
});

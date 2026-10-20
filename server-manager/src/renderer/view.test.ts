import { describe, expect, it } from "vitest";
import type { ServerState } from "../supervisor";
import { actionsFor, chooseMessage, formatBytes, formatCpu, formatUptime } from "./view";

describe("actionsFor", () => {
  const cases: [ServerState, { start: boolean; stop: boolean; restart: boolean }][] = [
    ["stopped", { start: true, stop: false, restart: false }],
    ["crashed", { start: true, stop: false, restart: false }],
    ["starting", { start: false, stop: true, restart: false }],
    ["running", { start: false, stop: true, restart: true }],
    ["stopping", { start: false, stop: false, restart: false }],
  ];
  it.each(cases)("%s", (state, expected) => {
    expect(actionsFor(state, true)).toEqual(expected);
  });

  it("enables nothing until a server folder is set", () => {
    expect(actionsFor("stopped", false)).toEqual({ start: false, stop: false, restart: false });
  });
});

describe("formatUptime", () => {
  it("shows a dash when not running", () => {
    expect(formatUptime(undefined)).toBe("—");
  });
  it("shows seconds, minutes, hours and days", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(59_999)).toBe("59s");
    expect(formatUptime(61_000)).toBe("1m 01s");
    expect(formatUptime(3_723_000)).toBe("1h 02m 03s");
    expect(formatUptime(90_061_000)).toBe("1d 01h 01m");
  });
  it("treats a negative or non-finite duration as no uptime", () => {
    expect(formatUptime(-5)).toBe("—");
    expect(formatUptime(Number.NaN)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("shows MB below a GB and GB above", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("formatCpu", () => {
  it("shows one decimal and a dash when unknown", () => {
    expect(formatCpu(undefined)).toBe("—");
    expect(formatCpu(12.345)).toBe("12.3%");
  });
});

describe("chooseMessage", () => {
  it("explains a refused folder and says nothing otherwise", () => {
    expect(chooseMessage({ ok: false, reason: "missing-exe" }, "server")).toMatch(/FactoryServer\.exe/);
    expect(chooseMessage({ ok: false, reason: "missing-exe" }, "steamcmd")).toMatch(/steamcmd\.exe/);
    expect(chooseMessage({ ok: false, reason: "busy" }, "server")).toMatch(/stop the server/i);
    expect(chooseMessage({ ok: false, reason: "cancelled" }, "server")).toBe("");
    expect(chooseMessage({ ok: true }, "server")).toBe("");
  });
});

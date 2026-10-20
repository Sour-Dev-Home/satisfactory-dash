import { describe, expect, it } from "vitest";
import type { Status } from "../ipc";
import type { ServerState } from "../supervisor";
import {
  actionsFor,
  anywayLabel,
  appendLine,
  chooseMessage,
  formatBytes,
  formatCpu,
  formatUptime,
  LOG_LINES,
  offerStartAfterUpdate,
  updateAllowed,
  updateNeedsConfirm,
  updateNote,
} from "./view";

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
    expect(chooseMessage({ ok: false, reason: "busy" }, "steamcmd")).toMatch(/update to finish/);
  });
});

const base: Status = {
  state: "stopped",
  lastError: undefined,
  leftoverPid: undefined,
  configured: true,
  serverDir: "D:\\server",
  steamcmdDir: "D:\\steamcmd",
  uptimeMs: undefined,
  cpuPercent: undefined,
  memoryBytes: undefined,
  anyway: undefined,
  updating: false,
  updateResult: undefined,
};

describe("updateAllowed", () => {
  it("applies stopped, crashed or running with a SteamCMD folder", () => {
    for (const state of ["stopped", "crashed", "running"] as const) expect(updateAllowed({ ...base, state })).toBe(true);
  });
  it("is off while starting or stopping, while an update runs, or with no SteamCMD folder", () => {
    expect(updateAllowed({ ...base, state: "starting" })).toBe(false);
    expect(updateAllowed({ ...base, state: "stopping" })).toBe(false);
    expect(updateAllowed({ ...base, updating: true })).toBe(false);
    expect(updateAllowed({ ...base, steamcmdDir: undefined })).toBe(false);
  });
  it("edge: is off with no server folder or a leftover server running", () => {
    expect(updateAllowed({ ...base, configured: false })).toBe(false);
    expect(updateAllowed({ ...base, leftoverPid: 77 })).toBe(false);
  });
});

describe("the update's words", () => {
  it("asks first only when the server runs", () => {
    expect(updateNeedsConfirm("running")).toBe(true);
    expect(updateNeedsConfirm("stopped")).toBe(false);
    expect(updateNeedsConfirm("crashed")).toBe(false);
  });
  it("says what's happening and how it ended", () => {
    expect(updateNote({ ...base, updating: true, state: "stopping" })).toMatch(/stopping the server/);
    expect(updateNote({ ...base, updating: true })).toMatch(/Updating with SteamCMD/);
    expect(updateNote({ ...base, updateResult: { ok: true, code: 0 } })).toBe("Update finished.");
    expect(updateNote({ ...base, updateResult: { ok: false, code: 8 } })).toMatch(/exited with code 8/);
    expect(updateNote({ ...base, steamcmdDir: undefined })).toMatch(/Choose the SteamCMD folder/);
    expect(updateNote(base)).toBe("");
  });
  it("offers Start after an update, once the server is stopped", () => {
    expect(offerStartAfterUpdate({ ...base, updateResult: { ok: true, code: 0 } })).toBe(true);
    expect(offerStartAfterUpdate({ ...base, updateResult: { ok: false, code: 8 } })).toBe(true);
    expect(offerStartAfterUpdate(base)).toBe(false);
    expect(offerStartAfterUpdate({ ...base, updateResult: { ok: true, code: 0 }, state: "running" })).toBe(false);
    expect(offerStartAfterUpdate({ ...base, updateResult: { ok: true, code: 0 }, leftoverPid: 5 })).toBe(false);
  });
  it("labels the without-saving offer by what it does", () => {
    expect(anywayLabel("stop")).toBe("Stop anyway");
    expect(anywayLabel("restart")).toBe("Restart anyway");
    expect(anywayLabel("update")).toBe("Stop anyway and update");
  });
});

describe("appendLine", () => {
  it("keeps the last LOG_LINES lines", () => {
    let lines: string[] = [];
    for (let i = 0; i < LOG_LINES + 3; i++) lines = appendLine(lines, `l${i}`);
    expect(lines).toHaveLength(LOG_LINES);
    expect(lines[0]).toBe("l3");
    expect(lines[LOG_LINES - 1]).toBe(`l${LOG_LINES + 2}`);
  });
});

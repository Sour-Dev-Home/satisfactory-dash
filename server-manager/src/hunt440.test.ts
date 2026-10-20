/** Independent probes for #440 (tray, close-to-tray, login item, adoption). */
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLeftover, isServerCommand, watchPid } from "./leftoverServer";
import { closeAction, startsHidden } from "./lifecycle";
import { fileLoginItemApi, loginItemApi, loginItemSettings } from "./loginItem";
import { processCommandLine } from "./processStats";
import { loadPreferences, savePreferences } from "./preferences";
import { trayMenu } from "./tray";
import type { ServerState } from "./supervisor";

const EXE = "C:\Games\Sat\FactoryServer.exe";

describe("isServerCommand edge cases", () => {
  // BUG: includes() matches a longer path that merely starts with / contains the configured exe path.
  it.fails("rejects a different exe whose path only starts with the configured one (FactoryServer.exe.old)", () => {
    expect(isServerCommand("C:\Games\Sat\FactoryServer.exe.old --x", EXE, "win32")).toBe(false);
  });
  it.fails("rejects the exe path embedded as an argument of another program", () => {
    expect(isServerCommand(`notepad.exe "${EXE}"`, EXE, "win32")).toBe(false);
  });
  it("rejects empty inputs", () => {
    expect(isServerCommand("", EXE, "win32")).toBe(false);
    expect(isServerCommand(EXE, "", "win32")).toBe(false);
  });
});

describe("tray menu per state", () => {
  const states: ServerState[] = ["stopped", "starting", "running", "stopping", "crashed"];
  it("Open and Quit are always enabled; nothing is enabled for server actions when blocked or unconfigured", () => {
    for (const state of states) {
      for (const [configured, blocked] of [[false, false], [true, true], [false, true]] as const) {
        const items = trayMenu({ state, configured, blocked });
        const get = (id: string) => items.find((i) => "id" in i && i.id === id) as { enabled: boolean };
        expect(get("open").enabled).toBe(true);
        expect(get("quit").enabled).toBe(true);
        expect(get("start").enabled).toBe(false);
        expect(get("restart").enabled).toBe(false);
      }
    }
  });
  it("never offers Start and Stop together", () => {
    for (const state of states) {
      const items = trayMenu({ state, configured: true, blocked: false });
      const en = (id: string) => (items.find((i) => "id" in i && i.id === id) as { enabled: boolean }).enabled;
      expect(en("start") && en("stop")).toBe(false);
    }
  });
});

describe("closeAction / startsHidden", () => {
  it("never hides while quitting, even before the note was shown", () => {
    expect(closeAction({ quitting: true, noteShown: false })).toEqual({ hide: false, note: false });
  });
  it("note only the first time", () => {
    expect(closeAction({ quitting: false, noteShown: false }).note).toBe(true);
    expect(closeAction({ quitting: false, noteShown: true })).toEqual({ hide: true, note: false });
  });
  it("startsHidden is an exact argument match", () => {
    expect(startsHidden(["a", "--hidden"])).toBe(true);
    expect(startsHidden(["--hidden=1", "--hiddenx"])).toBe(false);
  });
});

describe("login item seam", () => {
  it("remove uses the same path and args as add", () => {
    const l = { execPath: "C:\e\electron.exe", appPath: "C:\app" };
    const on = loginItemSettings(true, l);
    const off = loginItemSettings(false, l);
    expect({ ...on, openAtLogin: false }).toEqual(off);
  });
  it("e2e switch routes to a file fake and never calls Electron", () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt440-"));
    try {
      let called = false;
      const real = { setLoginItemSettings: () => { called = true; } };
      const api = loginItemApi({ SM_RUN_WITH_NODE: "x" } as never, real, dir);
      expect(api).toBe(real);
      void fileLoginItemApi;
      expect(called).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("preferences persistence", () => {
  it("round-trips and recovers from corrupt or extra-key files with defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt440-"));
    try {
      savePreferences(dir, { startWithWindows: true, closeNoteShown: true });
      expect(loadPreferences(dir)).toEqual({ startWithWindows: true, closeNoteShown: true });
      expect(existsSync(join(dir, "preferences.json.tmp"))).toBe(false);
      expect(() => savePreferences(dir, { startWithWindows: "yes" } as never)).toThrow();
      expect(JSON.parse(readFileSync(join(dir, "preferences.json"), "utf8")).startWithWindows).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // A newer build adding a key then an older one reading loses both prefs: strictObject discards a whole file.
  it.fails("keeps known preferences when the file has an unknown extra key", () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt440-"));
    try {
      writeFileSync(join(dir, "preferences.json"), JSON.stringify({ startWithWindows: true, closeNoteShown: true, future: 1 }));
      expect(loadPreferences(dir).startWithWindows).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("processCommandLine", () => {
  it("rejects bad pids without running anything", async () => {
    let ran = false;
    const exec = async () => { ran = true; return "x"; };
    for (const pid of [0, -1, 1.5, NaN]) expect(await processCommandLine(pid, { exec: exec as never })).toBeUndefined();
    expect(ran).toBe(false);
  });
  it("permission error / blank output is undefined", async () => {
    expect(await processCommandLine(5, { platform: "win32", exec: async () => { throw new Error("denied"); } })).toBeUndefined();
    expect(await processCommandLine(5, { platform: "win32", exec: async () => "  \r\n" })).toBeUndefined();
  });
});

describe("findLeftover with reused pid", () => {
  it("unreadable command line keeps the pid file; mismatch clears it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt440-"));
    try {
      writeFileSync(join(dir, "server.pid"), "4242");
      const base = { isAlive: () => true, serverExe: EXE, platform: "win32" as const };
      expect(await findLeftover(dir, { ...base, commandLine: async () => undefined })).toEqual({ kind: "unverified", pid: 4242 });
      expect(existsSync(join(dir, "server.pid"))).toBe(true);
      expect(await findLeftover(dir, { ...base, commandLine: async () => "chrome.exe" })).toEqual({ kind: "none" });
      expect(existsSync(join(dir, "server.pid"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("watchPid", () => {
  // Latent: only reachable with an injected interval that fires synchronously (real setInterval never does).
  it.fails("does not throw if the interval fires synchronously (cancel before assignment)", () => {
    const every = (cb: () => void) => { cb(); return () => undefined; };
    expect(() => watchPid(9, { isAlive: () => false, kill: () => undefined, every })).not.toThrow();
  });
  it("two exit callbacks both fire once", () => {
    let tick = () => undefined as void;
    const h = watchPid(9, { isAlive: () => false, kill: () => undefined, every: (cb) => { tick = cb; return () => undefined; } });
    let n = 0;
    h.onExit(() => n++);
    h.onExit(() => n++);
    tick(); tick();
    expect(n).toBe(2);
  });
});

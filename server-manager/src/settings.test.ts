import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATA_DIR_ENV,
  hasServerExe,
  hasSteamcmdExe,
  loadSettings,
  saveSettings,
  SERVER_EXE,
  settingsDir,
  settingsFile,
} from "./settings";

let dir: string;
const saved = process.env[DATA_DIR_ENV];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-settings-"));
  process.env[DATA_DIR_ENV] = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = saved;
});

describe("settingsDir", () => {
  it("is the environment override when set", () => {
    expect(settingsDir({ [DATA_DIR_ENV]: "Q:\\x" })).toBe("Q:\\x");
  });

  it("is satisfactory-dash-server-manager under LOCALAPPDATA otherwise", () => {
    expect(settingsDir({ LOCALAPPDATA: join("L", "AppData") })).toBe(
      join("L", "AppData", "satisfactory-dash-server-manager"),
    );
  });

  it("ignores an empty override", () => {
    expect(settingsDir({ [DATA_DIR_ENV]: "", LOCALAPPDATA: "L" })).toBe(join("L", "satisfactory-dash-server-manager"));
  });

  it("falls back under the home folder when LOCALAPPDATA is missing", () => {
    expect(settingsDir({})).toMatch(/satisfactory-dash-server-manager$/);
  });
});

describe("loadSettings / saveSettings", () => {
  it("returns undefined on first run (no file)", () => {
    expect(loadSettings()).toBeUndefined();
  });

  it("round-trips the server and SteamCMD folders through a JSON file", () => {
    const serverDir = join(dir, "server");
    const steamcmdDir = join(dir, "steamcmd");
    saveSettings({ serverDir, steamcmdDir });
    expect(loadSettings()).toEqual({ serverDir, steamcmdDir });
    expect(JSON.parse(readFileSync(settingsFile(), "utf8"))).toEqual({ serverDir, steamcmdDir });
  });

  it("the SteamCMD folder is optional", () => {
    const serverDir = join(dir, "server");
    saveSettings({ serverDir });
    expect(loadSettings()).toEqual({ serverDir });
  });

  it("creates the settings folder when it is missing", () => {
    const nested = join(dir, "a", "b");
    process.env[DATA_DIR_ENV] = nested;
    saveSettings({ serverDir: join(dir, "server") });
    expect(loadSettings()?.serverDir).toBe(join(dir, "server"));
  });

  it("refuses to save a relative or empty folder", () => {
    expect(() => saveSettings({ serverDir: "relative\\dir" })).toThrow();
    expect(() => saveSettings({ serverDir: "" })).toThrow();
    expect(() => saveSettings({ serverDir: join(dir, "s"), steamcmdDir: "rel" })).toThrow();
  });

  it("treats malformed JSON as no settings", () => {
    writeFileSync(settingsFile(), "{not json");
    expect(loadSettings()).toBeUndefined();
  });

  it("treats a file that fails the schema as no settings", () => {
    writeFileSync(settingsFile(), JSON.stringify({ serverDir: 42 }));
    expect(loadSettings()).toBeUndefined();
    writeFileSync(settingsFile(), JSON.stringify({ serverDir: join(dir, "s"), extra: true }));
    expect(loadSettings()).toBeUndefined();
    writeFileSync(settingsFile(), JSON.stringify([join(dir, "s")]));
    expect(loadSettings()).toBeUndefined();
  });
});

describe("hasServerExe / hasSteamcmdExe", () => {
  it("is true only for a folder holding FactoryServer.exe as a file", () => {
    const server = join(dir, "server");
    mkdirSync(server);
    expect(hasServerExe(server)).toBe(false);
    writeFileSync(join(server, SERVER_EXE), "");
    expect(hasServerExe(server)).toBe(true);
  });

  it("is false for a folder named FactoryServer.exe, a missing folder or a relative path", () => {
    const server = join(dir, "server");
    mkdirSync(join(server, SERVER_EXE), { recursive: true });
    expect(hasServerExe(server)).toBe(false);
    expect(hasServerExe(join(dir, "missing"))).toBe(false);
    expect(hasServerExe("relative")).toBe(false);
  });

  it("checks steamcmd.exe for the SteamCMD folder", () => {
    const steam = join(dir, "steam");
    mkdirSync(steam);
    expect(hasSteamcmdExe(steam)).toBe(false);
    writeFileSync(join(steam, "steamcmd.exe"), "");
    expect(hasSteamcmdExe(steam)).toBe(true);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HIDDEN_ARG } from "./lifecycle";
import {
  applyStartWithWindows,
  FAKE_LOGIN_ITEM_FILE,
  loginItemRegistered,
  fileLoginItemApi,
  loginItemApi,
  loginItemSettings,
  type LoginItemApi,
  type LoginItemSettings,
} from "./loginItem";
import { RUN_WITH_NODE_ENV } from "./serverProcess";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-login-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Stands in for Electron's app: records each call, so no test ever registers a real login item. */
function fakeElectron(): LoginItemApi & { calls: LoginItemSettings[] } {
  const calls: LoginItemSettings[] = [];
  return { calls, setLoginItemSettings: (s) => void calls.push(s), getLoginItemSettings: () => ({ openAtLogin: false }) };
}

describe("loginItemSettings", () => {
  it("from the checkout, runs this Electron with the app folder, hidden to the tray", () => {
    expect(loginItemSettings(true, { execPath: "E:\\e\\electron.exe", appPath: "E:\\app" })).toEqual({
      openAtLogin: true,
      path: "E:\\e\\electron.exe",
      args: ["E:\\app", HIDDEN_ARG],
    });
  });

  it("removes with the same path and arguments it added with", () => {
    const launch = { execPath: "E:\\e\\electron.exe", appPath: "E:\\app" };
    const on = loginItemSettings(true, launch);
    const off = loginItemSettings(false, launch);
    expect(off).toEqual({ ...on, openAtLogin: false });
  });

  it("packaged (no app folder), passes only the hidden argument", () => {
    expect(loginItemSettings(true, { execPath: "E:\\sm.exe", appPath: undefined }).args).toEqual([HIDDEN_ARG]);
  });
});

describe("loginItemApi", () => {
  it("is Electron's own API outside the e2e switch", () => {
    const real = fakeElectron();
    expect(loginItemApi({}, real, dir)).toBe(real);
  });

  it("under the e2e switch is a file fake, and Electron's API is never called", () => {
    const real = fakeElectron();
    const api = loginItemApi({ [RUN_WITH_NODE_ENV]: "1" }, real, dir);
    expect(api).not.toBe(real);
    api.setLoginItemSettings({ openAtLogin: true, path: "p", args: ["a"] });
    expect(real.calls).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, FAKE_LOGIN_ITEM_FILE), "utf8"))).toEqual({ openAtLogin: true, path: "p", args: ["a"] });
  });
});

describe("loginItemApi when packaged", () => {
  it("ignores the e2e switch and uses Electron's API", () => {
    const real = fakeElectron();
    expect(loginItemApi({ [RUN_WITH_NODE_ENV]: "1" }, real, dir, { packaged: true })).toBe(real);
  });
});

describe("applyStartWithWindows", () => {
  const launch = { execPath: "E:\\e\\electron.exe", appPath: "E:\\app" };

  it("sets the login item, then saves the preference", () => {
    const real = fakeElectron();
    const saved: boolean[] = [];
    expect(applyStartWithWindows(true, { api: real, launch, save: (on) => void saved.push(on) })).toEqual({ ok: true });
    expect(real.calls.map((c) => c.openAtLogin)).toEqual([true]);
    expect(saved).toEqual([true]);
  });

  it("when the login item can't be set, saves nothing and says why", () => {
    const saved: boolean[] = [];
    const api: LoginItemApi = {
      setLoginItemSettings: () => {
        throw new Error("access denied");
      },
      getLoginItemSettings: () => ({ openAtLogin: false }),
    };
    const result = applyStartWithWindows(true, { api, launch, save: (on) => void saved.push(on) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("access denied");
    expect(saved).toEqual([]);
  });

  it("when the preference can't be saved, puts the login item back as it was", () => {
    const real = fakeElectron();
    const result = applyStartWithWindows(true, {
      api: real,
      launch,
      save: () => {
        throw new Error("disk full");
      },
    });
    expect(result.ok).toBe(false);
    expect(real.calls.map((c) => c.openAtLogin)).toEqual([true, false]);
  });
});

describe("loginItemRegistered", () => {
  const launch = { execPath: "E:\\e\\electron.exe", appPath: "E:\\app" };

  it("asks the API with this checkout's path and arguments", () => {
    const asked: unknown[] = [];
    const api: LoginItemApi = {
      setLoginItemSettings: () => undefined,
      getLoginItemSettings: (o) => {
        asked.push(o);
        return { openAtLogin: true };
      },
    };
    expect(loginItemRegistered(api, launch)).toBe(true);
    expect(asked).toEqual([{ path: launch.execPath, args: [launch.appPath, HIDDEN_ARG] }]);
  });

  it("is undefined when the API throws (left as the preference says)", () => {
    const api: LoginItemApi = {
      setLoginItemSettings: () => undefined,
      getLoginItemSettings: () => {
        throw new Error("x");
      },
    };
    expect(loginItemRegistered(api, launch)).toBeUndefined();
  });

  it("the file fake reports registered only for the same path and arguments", () => {
    const api = fileLoginItemApi(join(dir, FAKE_LOGIN_ITEM_FILE));
    expect(loginItemRegistered(api, launch)).toBe(false);
    api.setLoginItemSettings(loginItemSettings(true, launch));
    expect(loginItemRegistered(api, launch)).toBe(true);
    expect(loginItemRegistered(api, { ...launch, appPath: "F:\\moved" })).toBe(false);
  });
});

describe("fileLoginItemApi", () => {
  it("writes the last settings to the file, creating its folder", () => {
    const file = join(dir, "nested", FAKE_LOGIN_ITEM_FILE);
    const api = fileLoginItemApi(file);
    expect(existsSync(file)).toBe(false);
    api.setLoginItemSettings({ openAtLogin: false, path: "p", args: [] });
    expect(JSON.parse(readFileSync(file, "utf8")).openAtLogin).toBe(false);
  });
});

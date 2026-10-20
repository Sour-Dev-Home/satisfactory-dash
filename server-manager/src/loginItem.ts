/**
 * Start with Windows: a per-user login item through Electron's app.setLoginItemSettings (on Windows, the current
 * user's Run entry that API manages). No Scheduled Task, no other registry write, no elevation. It is set only when
 * the owner flips the setting, never at launch.
 *
 * Under the e2e switch (RUN_WITH_NODE_ENV) the API is a file fake in the data folder instead, so a test run never
 * registers a real login item on the machine it runs on.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HIDDEN_ARG } from "./lifecycle";
import { RUN_WITH_NODE_ENV } from "./serverProcess";

export interface LoginItemSettings {
  openAtLogin: boolean;
  path: string;
  args: string[];
}

/** The slice of Electron's `app` this needs, so tests pass a fake. */
export interface LoginItemApi {
  setLoginItemSettings(settings: LoginItemSettings): void;
  /** Read-only: whether a login item with this path and these arguments is registered. */
  getLoginItemSettings?(options: { path: string; args: string[] }): { openAtLogin: boolean };
}

export interface Launch {
  execPath: string;
  appPath: string | undefined;
}

export type ApplyResult = { ok: true } | { ok: false; message: string };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Flips the login item, then saves the preference, so the two never disagree: nothing is saved when the login item
 * can't be set, and the login item is put back when the preference can't be saved. The message goes to the window.
 */
export function applyStartWithWindows(on: boolean, deps: { api: LoginItemApi; launch: Launch; save: (on: boolean) => void }): ApplyResult {
  try {
    deps.api.setLoginItemSettings(loginItemSettings(on, deps.launch));
  } catch (err) {
    return { ok: false, message: `Windows didn't take the change (${reason(err)}); Start with Windows is as it was.` };
  }
  try {
    deps.save(on);
  } catch (err) {
    try {
      deps.api.setLoginItemSettings(loginItemSettings(!on, deps.launch));
    } catch {
      // Already reporting a failure; the next flip sets it again.
    }
    return { ok: false, message: `The setting couldn't be saved (${reason(err)}); Start with Windows is as it was.` };
  }
  return { ok: true };
}

/**
 * Whether this checkout's login item is registered (read-only), so a preference left on after the checkout moved shows
 * as off. Undefined when it can't be told.
 */
export function loginItemRegistered(api: LoginItemApi, launch: Launch): boolean | undefined {
  if (!api.getLoginItemSettings) return undefined;
  const { path, args } = loginItemSettings(true, launch);
  try {
    return api.getLoginItemSettings({ path, args }).openAtLogin;
  } catch {
    return undefined;
  }
}

export const FAKE_LOGIN_ITEM_FILE = "login-item.test.json";

/**
 * What to register. Run from the checkout, the executable is Electron itself and needs the app folder; packaged, it
 * is the app. Removing passes the same path and arguments, which is how the API finds the entry to remove.
 */
export function loginItemSettings(on: boolean, launch: Launch): LoginItemSettings {
  return {
    openAtLogin: on,
    path: launch.execPath,
    args: launch.appPath === undefined ? [HIDDEN_ARG] : [launch.appPath, HIDDEN_ARG],
  };
}

/** Records the last settings to `file` instead of registering anything (the e2e tests read it). */
export function fileLoginItemApi(file: string): LoginItemApi {
  return {
    setLoginItemSettings(settings) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(settings)}\n`);
    },
    getLoginItemSettings({ path, args }) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<LoginItemSettings>;
        const same = saved.path === path && JSON.stringify(saved.args) === JSON.stringify(args);
        return { openAtLogin: same && saved.openAtLogin === true };
      } catch {
        return { openAtLogin: false };
      }
    },
  };
}

/** The e2e switch counts only when run from the checkout (`packaged` false), never in a packaged build. */
export function loginItemApi(
  env: NodeJS.ProcessEnv,
  electronApp: LoginItemApi,
  dataDir: string,
  opts: { packaged?: boolean } = {},
): LoginItemApi {
  const fake = opts.packaged !== true && env[RUN_WITH_NODE_ENV] === "1";
  return fake ? fileLoginItemApi(join(dataDir, FAKE_LOGIN_ITEM_FILE)) : electronApp;
}

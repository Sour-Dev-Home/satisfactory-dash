/**
 * Start with Windows: a per-user login item through Electron's app.setLoginItemSettings (on Windows, the current
 * user's Run entry that API manages). No Scheduled Task, no other registry write, no elevation. It is set only when
 * the owner flips the setting, never at launch.
 *
 * Under the e2e switch (RUN_WITH_NODE_ENV) the API is a file fake in the data folder instead, so a test run never
 * registers a real login item on the machine it runs on.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
}

export const FAKE_LOGIN_ITEM_FILE = "login-item.test.json";

/**
 * What to register. Run from the checkout, the executable is Electron itself and needs the app folder; packaged, it
 * is the app. Removing passes the same path and arguments, which is how the API finds the entry to remove.
 */
export function loginItemSettings(on: boolean, launch: { execPath: string; appPath: string | undefined }): LoginItemSettings {
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
  };
}

export function loginItemApi(env: NodeJS.ProcessEnv, electronApp: LoginItemApi, dataDir: string): LoginItemApi {
  return env[RUN_WITH_NODE_ENV] === "1" ? fileLoginItemApi(join(dataDir, FAKE_LOGIN_ITEM_FILE)) : electronApp;
}

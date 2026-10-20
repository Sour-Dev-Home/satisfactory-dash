/**
 * The server manager's settings (ADR-0040 decision 5): one JSON file under %LOCALAPPDATA%, set in the app on first
 * run. DATA_DIR_ENV moves it (the tests point it at a temp folder). No machine path is ever committed.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

export const DATA_DIR_ENV = "SATISFACTORY_SERVER_MANAGER_DATA_DIR";
export const SERVER_EXE = "FactoryServer.exe";
export const STEAMCMD_EXE = "steamcmd.exe";

const folder = z.string().min(1).refine(isAbsolute, "must be an absolute folder");

export const settingsSchema = z.strictObject({
  serverDir: folder,
  steamcmdDir: folder.optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export function settingsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DATA_DIR_ENV];
  if (override) return override;
  const base = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "satisfactory-dash-server-manager");
}

export function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(settingsDir(env), "settings.json");
}

/** The saved settings, or undefined on first run or when the file is unreadable or invalid (the app asks again). */
export function loadSettings(): Settings | undefined {
  let text: string;
  try {
    text = readFileSync(settingsFile(), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Validates, then writes through a temp file and a rename so a crash never leaves half a file. */
export function saveSettings(s: { serverDir: string; steamcmdDir?: string }): void {
  const valid = settingsSchema.parse(s);
  const file = settingsFile();
  mkdirSync(settingsDir(), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(valid, null, 2)}\n`);
  renameSync(tmp, file);
}

function hasFile(dir: string, name: string): boolean {
  if (!isAbsolute(dir)) return false;
  try {
    return statSync(join(dir, name)).isFile();
  } catch {
    return false;
  }
}

export function hasServerExe(serverDir: string): boolean {
  return hasFile(serverDir, SERVER_EXE);
}

export function hasSteamcmdExe(steamcmdDir: string): boolean {
  return hasFile(steamcmdDir, STEAMCMD_EXE);
}

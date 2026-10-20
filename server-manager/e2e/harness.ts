import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No trailing separator: on Windows `dir\"` in a quoted argument would escape the quote.
export const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fakeServer = fileURLToPath(new URL("./fake-server.cjs", import.meta.url));
const fakeSteamcmd = fileURLToPath(new URL("./fake-steamcmd.cjs", import.meta.url));

// Must match src/settings.ts and src/serverProcess.ts.
export const DATA_DIR_ENV = "SATISFACTORY_SERVER_MANAGER_DATA_DIR";
export const RUN_WITH_NODE_ENV = "SATISFACTORY_SERVER_MANAGER_TEST_RUN_WITH_NODE";
// Must match agent/src/store.ts resolveDataDir: the app reads the agent's store from here, never the real one.
export const AGENT_HOME_ENV = "SD_AGENT_HOME";

export interface Fixture {
  root: string;
  dataDir: string;
  serverDir: string;
  /** A folder with no FactoryServer.exe, for the refusal test. */
  emptyDir: string;
  /** Holds the fake steamcmd.exe. */
  steamcmdDir: string;
  /** The agent's data folder, empty: no API token is stored, so the clean stop offers "Stop anyway". */
  agentDir: string;
}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "sm-e2e-"));
  const dataDir = join(root, "data");
  const serverDir = join(root, "server");
  const emptyDir = join(root, "empty");
  const steamcmdDir = join(root, "steamcmd");
  const agentDir = join(root, "agent");
  for (const dir of [dataDir, serverDir, emptyDir, steamcmdDir, agentDir]) mkdirSync(dir);
  copyFileSync(fakeServer, join(serverDir, "FactoryServer.exe"));
  copyFileSync(fakeSteamcmd, join(steamcmdDir, "steamcmd.exe"));
  return { root, dataDir, serverDir, emptyDir, steamcmdDir, agentDir };
}

export function removeFixture(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function writeSettings(f: Fixture, opts: { steamcmd?: boolean } = {}): void {
  const settings = opts.steamcmd ? { serverDir: f.serverDir, steamcmdDir: f.steamcmdDir } : { serverDir: f.serverDir };
  writeFileSync(join(f.dataDir, "settings.json"), JSON.stringify(settings));
}

/** The arguments the fake SteamCMD was run with, or undefined if it never ran. */
export function steamcmdArgs(f: Fixture): string[] | undefined {
  const file = join(f.steamcmdDir, "steamcmd-args.log");
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8").split("\n").slice(0, -1);
}

/** Makes the fake SteamCMD exit with `code`. */
export function steamcmdExits(f: Fixture, code: number): void {
  writeFileSync(join(f.steamcmdDir, "steamcmd-exit"), String(code));
}

/** The environment the app runs in: the real one minus anything that would change how Electron starts. */
export function appEnv(f: Fixture): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ELECTRON_RUN_AS_NODE") env[k] = v;
  env[DATA_DIR_ENV] = f.dataDir;
  env[RUN_WITH_NODE_ENV] = "1";
  env[AGENT_HOME_ENV] = f.agentDir;
  return env;
}

export async function launch(f: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [appDir], cwd: appDir, env: appEnv(f) });
  const page = await app.firstWindow();
  return { app, page };
}

export interface Start {
  pid: number;
  args: string;
}

export function starts(f: Fixture): Start[] {
  const file = join(f.serverDir, "starts.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [pid, ...args] = line.trim().split(" ");
      return { pid: Number(pid), args: args.join(" ") };
    });
}

/** Drops a control file the fake server reacts to (see fake-server.cjs). */
export function tell(f: Fixture, what: "crash-now" | "exit-now" | "crash-always"): void {
  writeFileSync(join(f.serverDir, what), "");
}

/** Sets the agent's Scheduled Task's state as the fake Get-ScheduledTask reports it (e2e/fake-agent.cjs). */
export function agentTaskIs(f: Fixture, state: "Running" | "Ready" | "Disabled" | "Missing"): void {
  writeFileSync(join(f.agentDir, "fake-task"), state);
}

/** What the app asked the fake PowerShell and agent to do, in order, without the repeated state reads. */
export function agentCalls(f: Fixture): string[] {
  const file = join(f.agentDir, "fake-calls.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "" && line !== "powershell Get-ScheduledTask");
}

/** Appends lines to the agent's log for `day`, as the agent writes them. */
export function agentLogs(f: Fixture, day: string, lines: string[], partial = ""): void {
  const dir = join(f.agentDir, "logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `agent-${day}.log`), lines.map((l) => `${l}\n`).join("") + partial);
}

export function agentHalted(f: Fixture, reason: "credential_rejected" | "store_unreadable"): void {
  writeFileSync(join(f.agentDir, "halted.json"), `${JSON.stringify({ reason, at: "2026-10-20T10:00:00.000Z" })}\n`);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No trailing separator: on Windows `dir\"` in a quoted argument would escape the quote.
export const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fakeServer = fileURLToPath(new URL("./fake-server.cjs", import.meta.url));

// Must match src/settings.ts and src/serverProcess.ts.
export const DATA_DIR_ENV = "SATISFACTORY_SERVER_MANAGER_DATA_DIR";
export const RUN_WITH_NODE_ENV = "SATISFACTORY_SERVER_MANAGER_TEST_RUN_WITH_NODE";

export interface Fixture {
  root: string;
  dataDir: string;
  serverDir: string;
  /** A folder with no FactoryServer.exe, for the refusal test. */
  emptyDir: string;
}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "sm-e2e-"));
  const dataDir = join(root, "data");
  const serverDir = join(root, "server");
  const emptyDir = join(root, "empty");
  for (const dir of [dataDir, serverDir, emptyDir]) mkdirSync(dir);
  copyFileSync(fakeServer, join(serverDir, "FactoryServer.exe"));
  return { root, dataDir, serverDir, emptyDir };
}

export function removeFixture(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function writeSettings(f: Fixture): void {
  writeFileSync(join(f.dataDir, "settings.json"), JSON.stringify({ serverDir: f.serverDir }));
}

/** The environment the app runs in: the real one minus anything that would change how Electron starts. */
export function appEnv(f: Fixture): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ELECTRON_RUN_AS_NODE") env[k] = v;
  env[DATA_DIR_ENV] = f.dataDir;
  env[RUN_WITH_NODE_ENV] = "1";
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

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The portfolio screenshots of the server manager's window (issue #440), retaken with `npm run screenshots`. Each one
// runs the built app against the e2e fakes in a temp folder. The folder paths the window shows are those temp folders,
// so they are replaced with placeholders before each shot, and the shot is refused if a real one shows.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentLogs,
  agentTaskIs,
  appDir,
  launch,
  makeFixture,
  removeFixture,
  starts,
  tell,
  writeSettings,
  type Fixture,
} from "../e2e/harness";

// An output folder, not an input: built from segments so it reads as where the PNGs go.
const OUT = join(appDir, "..", "docs-vault", "wiki", "assets", "server-manager");

const PLACEHOLDER = { server: "D:\\SatisfactoryServer", steamcmd: "D:\\SteamCMD" };

let f: Fixture;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(() => {
  f = makeFixture();
});

test.afterEach(async () => {
  rmSync(join(f.steamcmdDir, "steamcmd-hold"), { force: true });
  await app?.close();
  app = undefined;
  removeFixture(f);
});

async function open(): Promise<void> {
  ({ app, page } = await launch(f));
}

/** Swaps the temp folders for placeholders, shoots the whole page, then checks nothing re-rendered a real path meanwhile. */
async function shoot(name: string): Promise<void> {
  await page.evaluate((p) => {
    document.getElementById("server-dir")!.textContent = p.server;
    const steam = document.getElementById("steamcmd-dir")!;
    if (steam.textContent !== "not set") steam.textContent = p.steamcmd;
  }, PLACEHOLDER);
  const png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toContain(f.root);
  expect(text).toContain(PLACEHOLDER.server);
  writeFileSync(join(OUT, name), png);
}

test("server running, with the agent panel", async () => {
  writeSettings(f, { steamcmd: true });
  agentTaskIs(f, "Running");
  agentLogs(
    f,
    "2026-10-20",
    ["agent_started", "game_reachable", "push_ok", "command_ran", "push_ok"].map((event, i) =>
      JSON.stringify({ t: `2026-10-20T10:00:${String(i * 5).padStart(2, "0")}.000Z`, level: "info", event }),
    ),
  );
  await open();
  await expect(page.getByTestId("agent-state")).toContainText("Running", { ignoreCase: true });
  await expect(page.getByTestId("agent-log").locator("li")).toHaveCount(5);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("state")).toHaveText("running");
  await expect.poll(() => starts(f).length).toBe(1);
  // CPU needs two samples, a few seconds apart.
  await expect(page.getByTestId("cpu")).not.toHaveText("—", { timeout: 20_000 });
  await expect(page.getByTestId("memory")).not.toHaveText("—");
  await shoot("window-running.png");
});

test("Start with Windows on (the login item is the e2e file fake)", async () => {
  writeSettings(f, { steamcmd: true });
  await open();
  await page.getByRole("checkbox", { name: "Start with Windows" }).check();
  await expect(page.getByRole("checkbox", { name: "Start with Windows" })).toBeChecked();
  await expect.poll(() => existsSync(join(f.dataDir, "login-item.test.json"))).toBe(true);
  await shoot("window-start-with-windows.png");
});

test("an update in progress", async () => {
  writeSettings(f, { steamcmd: true });
  writeFileSync(join(f.steamcmdDir, "steamcmd-hold"), "");
  await open();
  await expect(page.getByTestId("state")).toHaveText("stopped");
  await page.getByRole("button", { name: "Update server" }).click();
  await expect(page.getByTestId("update-log")).toContainText("progress: 100.00");
  await expect(page.getByTestId("update-note")).toHaveText("Updating with SteamCMD…");
  await shoot("window-updating.png");
});

test("crashed after the back-off", async () => {
  writeSettings(f, { steamcmd: true });
  tell(f, "crash-always");
  await open();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("state")).toHaveText("crashed", { timeout: 20_000 });
  await expect(page.getByTestId("last-error")).toContainText("not restarting");
  await shoot("window-crashed.png");
});

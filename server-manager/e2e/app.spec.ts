import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  alive,
  launch,
  makeFixture,
  removeFixture,
  starts,
  steamcmdArgs,
  steamcmdExits,
  tell,
  writeSettings,
  type Fixture,
} from "./harness";

let f: Fixture;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeEach(() => {
  f = makeFixture();
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  removeFixture(f);
});

async function open(): Promise<void> {
  ({ app, page } = await launch(f));
}

const state = () => page.getByTestId("state");
const button = (name: string) => page.getByRole("button", { name, exact: true });

async function expectButtons(enabled: { Start: boolean; Stop: boolean; Restart: boolean }): Promise<void> {
  for (const [name, on] of Object.entries(enabled)) {
    await expect(button(name)).toHaveAttribute("aria-disabled", String(!on));
    await expect(button(name)).not.toHaveAttribute("disabled");
  }
}

/** Makes the next folder picker return `dir` (or cancel), since a native dialog can't be driven. */
async function pickerReturns(dir: string | undefined): Promise<void> {
  await app!.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () =>
      picked === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] }) as never;
  }, dir);
}

async function startRunning(): Promise<void> {
  await button("Start").click();
  await expect(state()).toHaveText("running");
  // `running` means the process spawned; the fake logs its start a moment later.
  await expect.poll(() => starts(f).length).toBe(1);
}

test("first run asks for the server folder and refuses one without FactoryServer.exe", async () => {
  await open();
  await expect(page.getByRole("heading", { name: "Choose the server folder" })).toBeVisible();

  await pickerReturns(f.emptyDir);
  await page.getByRole("button", { name: "Choose folder…" }).click();
  await expect(page.getByRole("alert").first()).toContainText("no FactoryServer.exe");
  await expect(page.getByRole("heading", { name: "Dedicated server" })).toBeHidden();

  await pickerReturns(f.serverDir);
  await page.getByRole("button", { name: "Choose folder…" }).click();
  await expect(page.getByRole("heading", { name: "Dedicated server" })).toBeVisible();
  await expect(state()).toHaveText("stopped");
  await expect(page.getByTestId("server-dir")).toHaveText(f.serverDir);
  expect(JSON.parse(readFileSync(join(f.dataDir, "settings.json"), "utf8"))).toEqual({ serverDir: f.serverDir });
});

test("start runs FactoryServer.exe -log and shows the state, uptime, CPU and memory", async () => {
  writeSettings(f);
  await open();
  await expect(state()).toHaveText("stopped");
  await expectButtons({ Start: true, Stop: false, Restart: false });

  await startRunning();
  await expectButtons({ Start: false, Stop: true, Restart: true });
  expect(starts(f)).toHaveLength(1);
  expect(starts(f)[0]!.args).toBe("-log");

  await expect(page.getByTestId("uptime")).not.toHaveText("—", { timeout: 10_000 });
  await expect(page.getByTestId("memory")).toHaveText(/\d+(\.\d)? (MB|GB)/, { timeout: 10_000 });
  await expect(page.getByTestId("cpu")).toHaveText(/\d+\.\d%/, { timeout: 15_000 });
});

test("a disabled button keeps focus and does nothing", async () => {
  writeSettings(f);
  await open();
  await button("Stop").focus();
  await page.keyboard.press("Enter");
  await expect(button("Stop")).toBeFocused();
  await expect(state()).toHaveText("stopped");
  expect(starts(f)).toHaveLength(0);
});

test("a recorded pid that now belongs to another program is forgotten, never adopted", async () => {
  writeSettings(f);
  // A live process that isn't the configured FactoryServer.exe: the test runner itself (a reused pid).
  writeFileSync(join(f.dataDir, "server.pid"), `${process.pid}\n`);
  await open();
  await expect.poll(() => existsSync(join(f.dataDir, "server.pid"))).toBe(false);
  await expect(state()).toHaveText("stopped");
  await expectButtons({ Start: true, Stop: false, Restart: false });
  await startRunning();
  expect(readFileSync(join(f.dataDir, "server.pid"), "utf8").trim()).toBe(String(starts(f)[0]!.pid));
});

test("stop without the agent's token says so, keeps the server, and Stop anyway ends it", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  const pid = starts(f)[0]!.pid;
  await button("Stop").click();
  await expect(page.getByTestId("last-error")).toContainText("needs the agent set up");
  await expect(state()).toHaveText("running");
  expect(alive(pid)).toBe(true);

  await button("Stop anyway").click();
  await expect(state()).toHaveText("stopped");
  await expect(page.getByTestId("last-error")).toContainText("Stopped without a clean shutdown");
  await expect(button("Stop anyway")).toBeHidden();
  await expectButtons({ Start: true, Stop: false, Restart: false });
  await expect.poll(() => alive(pid)).toBe(false);
  await expect(page.getByTestId("uptime")).toHaveText("—");
  expect(existsSync(join(f.dataDir, "server.pid"))).toBe(false);
});

test("restart without the agent's token offers Restart anyway, which runs a new process", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  const first = starts(f)[0]!.pid;
  await button("Restart").click();
  await expect(page.getByTestId("last-error")).toContainText("needs the agent set up");
  expect(starts(f)).toHaveLength(1);
  await button("Restart anyway").click();
  await expect.poll(() => starts(f).length).toBe(2);
  await expect(state()).toHaveText("running");
  await expect.poll(() => alive(first)).toBe(false);
});

test("update is off until the SteamCMD folder is set", async () => {
  writeSettings(f);
  await open();
  await expect(button("Update server")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("update-note")).toContainText("Choose the SteamCMD folder");
  await button("Update server").click({ force: true });
  await page.waitForTimeout(500);
  expect(steamcmdArgs(f)).toBeUndefined();

  await pickerReturns(f.steamcmdDir);
  await button("Choose…").click();
  await expect(button("Update server")).toHaveAttribute("aria-disabled", "false");
});

test("update with the server stopped runs SteamCMD with exactly the update arguments and streams its output", async () => {
  writeSettings(f, { steamcmd: true });
  await open();
  await button("Update server").click();
  await expect(button("Update server")).toHaveAttribute("aria-disabled", "true");
  await expect(button("Start")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("update-log")).toContainText("progress: 25.00");
  await expect(page.getByTestId("update-note")).toHaveText("Update finished.", { timeout: 15_000 });
  await expect(page.getByTestId("update-log")).toContainText("Success! App '1690800' fully installed.");
  expect(steamcmdArgs(f)).toEqual([
    "+force_install_dir",
    f.serverDir,
    "+login",
    "anonymous",
    "+app_update",
    "1690800",
    "validate",
    "+quit",
  ]);
  await expect(button("Update server")).toHaveAttribute("aria-disabled", "false");

  await button("Start the server").click();
  await expect(state()).toHaveText("running");
  await expect(button("Start the server")).toBeHidden();
});

test("an update that fails reports SteamCMD's exit code", async () => {
  writeSettings(f, { steamcmd: true });
  steamcmdExits(f, 7);
  await open();
  await button("Update server").click();
  await expect(page.getByTestId("update-note")).toContainText("exited with code 7", { timeout: 15_000 });
  await expect(page.getByTestId("update-log")).toContainText("Error! App '1690800'");
  await expect(button("Start the server")).toBeVisible();
});

test("update with the server running asks first, stops it, then updates", async () => {
  writeSettings(f, { steamcmd: true });
  await open();
  await startRunning();
  const pid = starts(f)[0]!.pid;

  await button("Update server").click();
  await expect(page.getByText("Update saves and stops the server first")).toBeVisible();
  await button("Cancel").click();
  await expect(page.getByText("Update saves and stops the server first")).toBeHidden();
  expect(alive(pid)).toBe(true);

  await button("Update server").click();
  await button("Stop and update").click();
  // No token in the test's agent folder: the clean stop can't save, so nothing is stopped or updated yet.
  await expect(page.getByTestId("last-error")).toContainText("needs the agent set up");
  expect(alive(pid)).toBe(true);
  expect(steamcmdArgs(f)).toBeUndefined();

  await button("Stop anyway and update").click();
  await expect(page.getByTestId("update-note")).toHaveText("Update finished.", { timeout: 15_000 });
  expect(alive(pid)).toBe(false);
  expect(steamcmdArgs(f)?.[1]).toBe(f.serverDir);
  await expect(state()).toHaveText("stopped");
  await button("Start the server").click();
  await expect.poll(() => starts(f).length).toBe(2);
  await expect(state()).toHaveText("running");
});

test("the window's bridge has no way to get a token", async () => {
  writeSettings(f);
  await open();
  const keys = await page.evaluate(() => Object.keys((window as unknown as { serverManager: object }).serverManager).sort());
  expect(keys).toEqual(
    [
      "chooseServerDir",
      "chooseSteamcmdDir",
      "getStatus",
      "onStatus",
      "onUpdateLine",
      "restart",
      "start",
      "stop",
      "update",
      "getAgentStatus",
      "onAgentStatus",
      "startAgent",
      "stopAgent",
      "runAgentCommand",
      "openAgentRunbook",
      "setStartWithWindows",
    ].sort(),
  );
  const status = await page.evaluate(() => (window as unknown as { serverManager: { getStatus(): Promise<object> } }).serverManager.getStatus());
  expect(JSON.stringify(status)).not.toMatch(/token|secret/i);
  const agent = await page.evaluate(() => (window as unknown as { serverManager: { getAgentStatus(): Promise<object> } }).serverManager.getAgentStatus());
  expect(JSON.stringify(agent)).not.toMatch(/token|secret/i);
});

test("a crash restarts the server and says why", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  tell(f, "crash-now");
  await expect.poll(() => starts(f).length).toBe(2);
  await expect(state()).toHaveText("running");
  await expect(page.getByTestId("last-error")).toContainText("exit code 1");
});

test("an exit the app didn't ask for restarts it too", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  tell(f, "exit-now");
  await expect.poll(() => starts(f).length).toBe(2);
  await expect(state()).toHaveText("running");
});

test("repeated crashes end in crashed after 3 restarts, with the reason shown", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  tell(f, "crash-always");
  tell(f, "crash-now");
  await expect(state()).toHaveText("crashed", { timeout: 15_000 });
  await expect.poll(() => starts(f).length).toBe(4);
  await expect(page.getByTestId("last-error")).toContainText("not restarting");
  await expectButtons({ Start: true, Stop: false, Restart: false });
  await page.waitForTimeout(1500);
  expect(starts(f)).toHaveLength(4);
});

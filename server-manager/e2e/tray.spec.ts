// The tray, the window's lifecycle and Start with Windows (issue #440), against the fake server. The OS tray itself
// can't be driven, so the tests read and press the tray's real menu items through main's e2e hook (harness trayOf).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  alive,
  appDir,
  appEnv,
  clickTray,
  closeNotes,
  end,
  launch,
  makeFixture,
  removeFixture,
  starts,
  tell,
  trayOf,
  windowVisible,
  writeSettings,
  type Fixture,
} from "./harness";

const electronPath = createRequire(import.meta.url)("electron") as string;

let f: Fixture;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeEach(() => {
  f = makeFixture();
});

test.afterEach(async () => {
  // End any fake server kept running first: one alive holds the app's stdio open, and close() would wait for it.
  rmSync(join(f.serverDir, "keep-running"), { force: true });
  for (const s of starts(f)) end(s.pid);
  await app?.close();
  app = undefined;
  for (const s of starts(f)) end(s.pid);
  removeFixture(f);
});

async function open(): Promise<void> {
  ({ app, page } = await launch(f));
}

const state = () => page.getByTestId("state");

/**
 * Presses Quit and waits for the app's process to be gone. Not Playwright's "close" event: on Windows the server left
 * running inherits the app's stdio pipes, so Playwright never sees them close.
 */
async function quitFromTray(): Promise<void> {
  const mainPid = app!.process().pid!;
  // The app can end before the click's answer comes back.
  await clickTray(app!, "quit").catch(() => undefined);
  await expect.poll(() => alive(mainPid), { timeout: 15_000 }).toBe(false);
  app = undefined;
}

const enabledItems = async () =>
  Object.fromEntries((await trayOf(app!)).items.flatMap((i) => ("id" in i ? [[i.id, i.enabled]] : [])));

test("the tray's colour and tooltip follow the server, and its menu starts and stops it", async () => {
  writeSettings(f);
  await open();
  await expect.poll(async () => (await trayOf(app!)).colour).toBe("red");
  expect((await trayOf(app!)).tooltip).toBe("Satisfactory server: stopped");
  const labels = (await trayOf(app!)).items.flatMap((i) => ("label" in i ? [i.label] : []));
  expect(labels).toEqual(["Open", "Start", "Stop", "Restart", "Quit", "Stop server and quit"]);
  expect(await enabledItems()).toMatchObject({ start: true, stop: false, restart: false });

  await clickTray(app!, "start");
  await expect(state()).toHaveText("running");
  await expect.poll(async () => (await trayOf(app!)).colour).toBe("green");
  expect((await trayOf(app!)).tooltip).toBe("Satisfactory server: running");
  expect(await enabledItems()).toMatchObject({ start: false, stop: true, restart: true, "stop-and-quit": true });

  // No token in the test's agent folder: the clean stop can't save, so the window offers Stop anyway.
  await clickTray(app!, "stop");
  await expect(page.getByRole("button", { name: "Stop anyway" })).toBeVisible();
  await page.getByRole("button", { name: "Stop anyway" }).click();
  await expect(state()).toHaveText("stopped");
  await expect.poll(async () => (await trayOf(app!)).colour).toBe("red");
});

test("a crash past the back-off turns the tray red with the crashed state", async () => {
  writeSettings(f);
  tell(f, "crash-always");
  await open();
  await clickTray(app!, "start");
  await expect(state()).toHaveText("crashed", { timeout: 15_000 });
  await expect.poll(async () => (await trayOf(app!)).tooltip).toBe("Satisfactory server: crashed");
  expect((await trayOf(app!)).colour).toBe("red");
});

test("closing the window hides it to the tray, says so once, and Open brings it back", async () => {
  writeSettings(f);
  await open();
  await expect(state()).toHaveText("stopped");
  expect(await windowVisible(app!)).toBe(true);

  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => windowVisible(app!)).toBe(false);
  expect(await closeNotes(app!)).toBe(1);
  expect(JSON.parse(readFileSync(join(f.dataDir, "preferences.json"), "utf8")).closeNoteShown).toBe(true);

  await clickTray(app!, "open");
  await expect.poll(() => windowVisible(app!)).toBe(true);
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => windowVisible(app!)).toBe(false);
  expect(await closeNotes(app!)).toBe(1);
});

test("a second launch shows the first one's window and ends", async () => {
  writeSettings(f);
  await open();
  await expect(state()).toHaveText("stopped");
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => windowVisible(app!)).toBe(false);

  const second = spawn(electronPath, [appDir], { cwd: appDir, env: appEnv(f), stdio: "ignore" });
  const code = await new Promise<number | null>((resolve) => second.on("exit", resolve));
  expect(code).toBe(0);
  await expect.poll(() => windowVisible(app!)).toBe(true);
  expect(starts(f)).toHaveLength(0);
});

test("Quit leaves the server running, and the next launch adopts it instead of starting another", async () => {
  writeSettings(f);
  tell(f, "keep-running");
  await open();
  await clickTray(app!, "start");
  await expect(state()).toHaveText("running");
  await expect.poll(() => starts(f).length).toBe(1);
  const pid = starts(f)[0]!.pid;

  await quitFromTray();
  expect(alive(pid)).toBe(true);
  expect(readFileSync(join(f.dataDir, "server.pid"), "utf8").trim()).toBe(String(pid));

  await open();
  await expect(state()).toHaveText("running");
  await expect.poll(async () => (await trayOf(app!)).colour).toBe("green");
  expect(starts(f)).toHaveLength(1);

  // Supervised again: Stop anyway ends that same process.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Stop anyway" }).click();
  await expect(state()).toHaveText("stopped");
  await expect.poll(() => alive(pid)).toBe(false);
  expect(existsSync(join(f.dataDir, "server.pid"))).toBe(false);
});

test("an adopted server that dies is restarted, as one the app started would be", async () => {
  writeSettings(f);
  tell(f, "keep-running");
  await open();
  await clickTray(app!, "start");
  await expect.poll(() => starts(f).length).toBe(1);
  await quitFromTray();

  await open();
  await expect(state()).toHaveText("running");
  tell(f, "exit-now");
  await expect.poll(() => starts(f).length, { timeout: 10_000 }).toBe(2);
  await expect(page.getByTestId("last-error")).toContainText("stopped on its own");
  await expect(state()).toHaveText("running");
});

test("Stop server and quit does the clean stop first, and stays open when it can't save", async () => {
  writeSettings(f);
  await open();
  await clickTray(app!, "start");
  await expect(state()).toHaveText("running");
  // `running` means the process spawned; the fake logs its start a moment later.
  await expect.poll(() => starts(f).length).toBe(1);
  const pid = starts(f)[0]!.pid;
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => windowVisible(app!)).toBe(false);

  await clickTray(app!, "stop-and-quit");
  // No token: nothing was stopped, the app is still here, and the window is back offering Stop anyway.
  await expect.poll(() => windowVisible(app!)).toBe(true);
  await expect(page.getByRole("button", { name: "Stop anyway" })).toBeVisible();
  await expect(page.getByTestId("last-error")).toContainText("needs the agent set up");
  expect(alive(pid)).toBe(true);
});

test("Start with Windows is off by default and flips the login item (Electron's API faked)", async () => {
  writeSettings(f);
  await open();
  const box = page.getByRole("checkbox", { name: "Start with Windows" });
  await expect(box).not.toBeChecked();
  const fakeFile = join(f.dataDir, "login-item.test.json");
  expect(existsSync(fakeFile)).toBe(false);

  await box.check();
  await expect.poll(() => existsSync(fakeFile)).toBe(true);
  const on = JSON.parse(readFileSync(fakeFile, "utf8"));
  expect(on).toEqual({ openAtLogin: true, path: expect.any(String), args: [appDir, "--hidden"] });
  expect(JSON.parse(readFileSync(join(f.dataDir, "preferences.json"), "utf8")).startWithWindows).toBe(true);

  await box.uncheck();
  await expect.poll(() => JSON.parse(readFileSync(fakeFile, "utf8")).openAtLogin).toBe(false);
  expect(JSON.parse(readFileSync(fakeFile, "utf8")).args).toEqual(on.args);

  await app!.close();
  app = undefined;
  await open();
  await expect(page.getByRole("checkbox", { name: "Start with Windows" })).not.toBeChecked();
});

test("Start with Windows stays on across launches while its login item is this checkout's", async () => {
  writeSettings(f);
  await open();
  await page.getByRole("checkbox", { name: "Start with Windows" }).check();
  await expect.poll(() => existsSync(join(f.dataDir, "login-item.test.json"))).toBe(true);
  await app!.close();
  app = undefined;
  await open();
  await expect(page.getByRole("checkbox", { name: "Start with Windows" })).toBeChecked();
});

test("a Start with Windows left on for a checkout that moved shows as off", async () => {
  writeSettings(f);
  writeFileSync(join(f.dataDir, "preferences.json"), JSON.stringify({ startWithWindows: true, closeNoteShown: false }));
  // The login item still points at the checkout's old place.
  writeFileSync(
    join(f.dataDir, "login-item.test.json"),
    JSON.stringify({ openAtLogin: true, path: "E:\\old\\electron.exe", args: ["E:\\old\\server-manager", "--hidden"] }),
  );
  await open();
  await expect(state()).toHaveText("stopped");
  await expect(page.getByRole("checkbox", { name: "Start with Windows" })).not.toBeChecked();
  // Read only: the stale entry is left alone.
  expect(JSON.parse(readFileSync(join(f.dataDir, "login-item.test.json"), "utf8")).path).toBe("E:\\old\\electron.exe");
});

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alive, launch, makeFixture, removeFixture, starts, tell, writeSettings, type Fixture } from "./harness";

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

test("stop ends the process", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  const pid = starts(f)[0]!.pid;
  await button("Stop").click();
  await expect(state()).toHaveText("stopped");
  await expectButtons({ Start: true, Stop: false, Restart: false });
  await expect.poll(() => alive(pid)).toBe(false);
  await expect(page.getByTestId("uptime")).toHaveText("—");
});

test("restart runs a new process", async () => {
  writeSettings(f);
  await open();
  await startRunning();
  const first = starts(f)[0]!.pid;
  await button("Restart").click();
  await expect.poll(() => starts(f).length).toBe(2);
  await expect(state()).toHaveText("running");
  await expect.poll(() => alive(first)).toBe(false);
  await expect(page.getByTestId("last-error")).toBeHidden();
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

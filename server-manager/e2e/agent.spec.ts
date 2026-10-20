// The Agent panel against fakes (e2e/fake-agent.cjs): the agent's Scheduled Task, its log, its halted marker and its
// check/status/resume. Nothing here reaches the real Task Scheduler or agent: under the e2e switch the app runs the fake.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  agentCalls,
  agentHalted,
  agentLogs,
  agentTaskIs,
  launch,
  makeFixture,
  removeFixture,
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

const panel = () => page.getByRole("region", { name: "Agent" });
const agentState = () => page.getByTestId("agent-state");
const button = (name: string) => panel().getByRole("button", { name, exact: true });
const logLines = () => page.getByTestId("agent-log").locator("li");
const line = (n: number, event = "push_ok") =>
  JSON.stringify({ t: `2026-10-20T10:00:${String(n).padStart(2, "0")}.000Z`, level: "info", event, code: `c${n}` });

test("shows the task's state and starts and stops it", async () => {
  await open();
  await expect(agentState()).toHaveText("ready");
  await expect(button("Start agent")).toHaveAttribute("aria-disabled", "false");
  await expect(button("Stop agent")).toHaveAttribute("aria-disabled", "true");

  await button("Start agent").click();
  await expect(agentState()).toHaveText("running");
  await expect(button("Stop agent")).toHaveAttribute("aria-disabled", "false");
  await expect(button("Start agent")).toHaveAttribute("aria-disabled", "true");

  await button("Stop agent").click();
  await expect(agentState()).toHaveText("ready");
  expect(agentCalls(f)).toEqual(["powershell Start-ScheduledTask", "powershell Stop-ScheduledTask"]);
});

test("follows the task's state as it changes outside the app", async () => {
  agentTaskIs(f, "Running");
  await open();
  await expect(agentState()).toHaveText("running");
  agentTaskIs(f, "Disabled");
  await expect(agentState()).toHaveText("disabled");
  await expect(page.getByTestId("agent-note")).toContainText("Task Scheduler");
  await expect(button("Start agent")).toHaveAttribute("aria-disabled", "true");
  await expect(button("Stop agent")).toHaveAttribute("aria-disabled", "true");
});

test("a missing task shows the runbook link instead of Start and Stop", async () => {
  agentTaskIs(f, "Missing");
  await open();
  await app!.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = (async (url: string) => {
      opened.push(url);
    }) as never;
  });
  await expect(agentState()).toHaveText("not set up");
  await expect(button("Start agent")).toBeHidden();
  await expect(button("Stop agent")).toBeHidden();
  await button("How to set up the agent's Scheduled Task (runbook)").click();
  await expect
    .poll(() => app!.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual([
      "https://github.com/Sour-Dev-Home/satisfactory-dash/blob/main/docs-vault/wiki/runbooks/agent-app.md#keeping-it-running-a-scheduled-task",
    ]);
});

test("shows the newest 20 log lines as written, follows the file and a new day's file", async () => {
  agentLogs(f, "2026-10-20", Array.from({ length: 25 }, (_, i) => line(i)));
  await open();
  await expect(logLines()).toHaveCount(20);
  await expect(logLines().first()).toContainText("2026-10-20T10:00:05.000Z");
  await expect(logLines().last()).toContainText("push_ok");
  await expect(logLines().last()).toContainText("code=c24");

  // A line still being written stays out until it ends.
  agentLogs(f, "2026-10-20", [line(25, "agent_started")], line(26, "half").slice(0, 20));
  await expect(logLines().last()).toContainText("agent_started");
  await expect(logLines()).toHaveCount(20);
  await expect(page.getByTestId("agent-log")).not.toContainText("half");

  agentLogs(f, "2026-10-21", [line(1, "new_day")]);
  await expect(logLines()).toHaveCount(1);
  await expect(logLines().first()).toContainText("new_day");
});

test("Check and Status run the agent's commands and show their output; nothing asks for secrets", async () => {
  await open();
  await button("Check").click();
  await expect(page.getByTestId("agent-command-heading")).toHaveText("agent check: finished");
  await expect(page.getByTestId("agent-output")).toContainText("fake check");
  await button("Status").click();
  await expect(page.getByTestId("agent-command-heading")).toHaveText("agent status: finished");
  await expect(page.getByTestId("agent-output")).toContainText("fake status");
  expect(agentCalls(f)).toEqual(["agent check", "agent status"]);
  await expect(panel().getByRole("button", { name: /set-tokens|enroll|tokens|enrol/i })).toHaveCount(0);
});

test("a halted agent shows the reason and the fix, and Resume runs resume", async () => {
  agentHalted(f, "store_unreadable");
  await open();
  const halted = page.getByTestId("agent-halted");
  await expect(halted).toBeVisible();
  await expect(halted).toContainText("could not unprotect its store");
  await expect(halted).toContainText("Windows user");
  await button("Resume").click();
  await expect(halted).toBeHidden();
  expect(agentCalls(f)).toEqual(["agent resume"]);
  expect(existsSync(join(f.agentDir, "halted.json"))).toBe(false);
});

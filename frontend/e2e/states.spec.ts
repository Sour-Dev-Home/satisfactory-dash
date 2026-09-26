import type { Page } from "@playwright/test";
import type { ScenarioName } from "../src/test/scenarios";
import { expect, expectNoAxeViolations, settleAnimations, test } from "./fixtures";

// Every UI state from ADR-0016 item 5, at 1440 and 390 px (the two projects): wait until the
// state is actually on screen, fail on any axe violation, then compare a full-page screenshot.

async function signIn(page: Page) {
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("example-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}

interface StateCase {
  scenario: ScenarioName;
  /** Visible text that proves the state has rendered. */
  shows: string | RegExp;
  /** The page to open (default: the Overview). */
  path?: string;
  /** Screenshot and test name, when one scenario is shown on several pages. */
  name?: string;
  /** Extra steps before the check, e.g. submitting the login form. */
  act?: (page: Page) => Promise<void>;
  /**
   * A fixed "now" (ISO) for a state that shows a value from the clock, such as the mute field's
   * default of an hour ahead. Without it, the screenshot differs from run to run.
   */
  clock?: string;
}

/** The fixtures' own day, so a frozen clock sits among their times. */
const FIXTURE_NOW = "2026-09-26T12:00:00.000Z";

const CASES: StateCase[] = [
  { scenario: "default", shows: "Total play time on this save" },
  { scenario: "default", name: "default-power", path: "/app/power", shows: /Circuit 0/ },
  { scenario: "default", name: "default-factory", path: "/app/factory", shows: /machines · .* backed up/ },
  { scenario: "default", name: "default-settings", path: "/app/settings", shows: /Auto-pause when no players/ },
  { scenario: "loading", shows: "Checking session…" },
  { scenario: "login", shows: "Sign in" },
  { scenario: "login-google", shows: "Sign in with Google" },
  {
    scenario: "login-google-error",
    path: "/app/login?error=not_invited",
    shows: "This Google account hasn't been invited yet. Ask the server's owner for an invitation.",
  },
  { scenario: "login-failed", shows: "Invalid username or password", act: signIn },
  { scenario: "login-rate-limited", shows: "Try again later", act: signIn },
  { scenario: "no-servers", shows: "No game servers are configured." },
  { scenario: "server-picker", shows: "Choose a game server" },
  // The Overview says "paused" in its Server row; the banner is on the other pages only.
  { scenario: "paused", shows: "Paused: no players connected" },
  { scenario: "paused", name: "paused-power", path: "/app/power", shows: "Paused: no players connected, values are frozen." },
  { scenario: "stale", shows: /Showing last known data from/ },
  // The Health card's tick dial and text (the red zone is below 10 ticks/s).
  { scenario: "slow-tick", shows: "8.2 ticks/s" },
  // With FicsitRemoteMonitoring, the online names show under the count (ADR-0029).
  { scenario: "players-some", shows: "Pioneer-Alpha" },
  { scenario: "players-many", shows: "10 of 12 players connected" },
  { scenario: "players-0-of-12", shows: "0 of 12 players connected" },
  { scenario: "players-7-of-12", shows: "Pioneer-07" },
  { scenario: "players-12-of-12", shows: "12 of 12 players connected" },
  { scenario: "no-game", shows: "No save loaded" },
  // The Overview banner: its text also holds the hidden "!" icon, so no ^ anchor.
  { scenario: "outage", shows: /Power outage$/ },
  { scenario: "outage", name: "outage-power", path: "/app/power", shows: /Power outage: 1 circuit has a tripped fuse/ },
  { scenario: "at-risk", path: "/app/power", shows: "1 circuit is at risk." },
  // The live power chart (ADR-0022). default-power above is the normal case.
  { scenario: "history-paused", path: "/app/power", shows: /Paused \(shaded\):/ },
  // Empty history right after the backend starts: the first regular poll is the only point.
  { scenario: "history-empty", path: "/app/power", shows: "Collecting readings. The chart starts after the next poll." },
  { scenario: "history-fuse-trip", path: "/app/power", shows: "Circuit 1" },
  { scenario: "battery-charging", path: "/app/power", shows: /Charging 100 MW/ },
  { scenario: "battery-discharging", path: "/app/power", shows: /Discharging 80 MW/ },
  // The modded item has no unit, so it alone falls back to "per min" (ADR-0015).
  { scenario: "unknown-units", path: "/app/factory", shows: /Modded Widget: .* per min/ },
  { scenario: "factory-states", path: "/app/factory", shows: "Unpowered" },
  { scenario: "settings-read-only", path: "/app/settings", shows: /Read-only: the backend has no verified admin token/ },
  { scenario: "settings-pending", path: "/app/settings", shows: "Change pending: the server will apply it." },
  // ADR-0031 PR 4: auto-pause on a server reached through the game PC's agent, after the toggle.
  {
    scenario: "settings-relayed-saving",
    path: "/app/settings",
    shows: "Saving…",
    act: (page) => page.getByRole("checkbox", { name: /Auto-pause when no players are connected/ }).click(),
  },
  {
    scenario: "settings-relayed-failed",
    path: "/app/settings",
    shows: /couldn't reach the game server, so the setting didn't change/,
    act: (page) => page.getByRole("checkbox", { name: /Auto-pause when no players are connected/ }).click(),
  },
  { scenario: "upstream-unreachable", shows: "Game server unreachable." },
  { scenario: "upstream-auth-rejected", shows: /credentials for the game server were rejected/ },
  { scenario: "upstream-invalid", shows: "The game server returned an error." },
  // The envelope's own message (the generic branch). "Request ID:" shows for every API error.
  { scenario: "unknown-error-code", shows: /^Something went wrong$/ },
  { scenario: "backend-unreachable", shows: "Couldn't reach the dashboard backend." },
  { scenario: "contract-drift", shows: /doesn't understand/ },
  // Server management (ADR-0030), operator only: the three stored states, then the add form's refusals.
  { scenario: "servers-manage", path: "/app/servers", shows: "This server's saved address isn't allowed. Edit the host or remove it." },
  { scenario: "servers-manage", name: "servers-add-form", path: "/app/servers", shows: "Leave blank if FRM runs without a token.", act: openAddForm },
  { scenario: "servers-first", shows: "No game servers yet. Add the first one; for now it has to run on this machine." },
  {
    scenario: "servers-lan-refused",
    path: "/app/servers",
    shows: "Only servers on this machine can be added for now.",
    act: (page) => addServer(page, "192.168.1.20"),
  },
  {
    scenario: "servers-import-required",
    path: "/app/servers",
    shows: /Import them first/,
    act: (page) => addServer(page, "127.0.0.1"),
  },
  {
    scenario: "servers-test-failed",
    path: "/app/servers",
    shows: "Game API: rejected the token",
    act: (page) => page.getByRole("button", { name: "Test connection" }).first().click(),
  },
  // Stored power history (ADR-0027, #74): the 24-hour range, with a gap and a fuse trip.
  {
    scenario: "default",
    name: "power-history-24h",
    path: "/app/power",
    shows: "Last 24 hours",
    // The click can scroll the page and the page then scroll back, leaving the pointer over the
    // Account button (a hover border in the screenshot, #255). Move it into the empty gutter.
    act: async (page) => {
      await page.getByRole("group", { name: "Power history range" }).getByRole("button", { name: "24 h" }).click();
      await page.mouse.move(0, 0);
    },
  },
  // Alerts (ADR-0027 PR 9): the header bell's dropdown, opened. "alerts" also shows the bell's badge.
  { scenario: "alerts", shows: /Delivery is off \(shadow week\)/, act: openAlerts },
  { scenario: "alerts", name: "alerts-badge-overview", shows: "Total play time on this save" },
  // An alert expanded in place.
  {
    scenario: "alerts",
    name: "alerts-expanded",
    shows: /118\.4 per min against a target of 120 per min/,
    act: async (page) => {
      await openAlerts(page);
      await page.getByRole("region", { name: "Recent" }).getByRole("button").first().click();
    },
  },
  { scenario: "alerts-empty", shows: "No alerts yet.", act: openAlerts },
  // Settings → Alerts (ADR-0027 PR 9c): an owner gets the mute, the Discord setup and the rules
  // editor; a viewer reads the same section with no controls. A webhook Discord deleted shows there.
  // The clock is fixed: the mute field defaults to an hour from now.
  { scenario: "alerts-owner", path: "/app/settings", shows: "New production target", clock: FIXTURE_NOW },
  { scenario: "alerts-viewer", path: "/app/settings", shows: "Only a server owner or admin can change alert rules.", clock: FIXTURE_NOW },
  { scenario: "alerts-webhook-gone", path: "/app/settings", shows: /no longer exists/, clock: FIXTURE_NOW },
];

async function openAddForm(page: Page) {
  await page.getByRole("button", { name: "Add a server" }).click();
}

/** Opens the header bell's dropdown (ADR-0027 PR 9) and lets it finish popping in. */
async function openAlerts(page: Page) {
  await page.getByRole("button", { name: /^Alerts/ }).click();
  await settleAnimations(page);
}

async function addServer(page: Page, host: string) {
  await openAddForm(page);
  await page.getByLabel("Server id").fill("second");
  await page.getByLabel("Name").fill("Second world");
  await page.getByLabel("Host").fill(host);
  await page.getByLabel("Game API token").fill("example-token");
  await page.getByRole("button", { name: "Add server" }).click();
}

for (const { scenario, shows, path = "/app", name = scenario, act, clock } of CASES) {
  test(`state: ${name}`, async ({ page, mockApi }, testInfo) => {
    await mockApi(scenario);
    // Date.now() is fixed; timers still run, so polling and React behave as usual.
    if (clock) await page.clock.setFixedTime(clock);
    await page.goto(path);
    if (act) {
      // Sign-in states act on the login form once it's there; the rest act on their page, and
      // Playwright's actions wait for their own element.
      if (scenario.startsWith("login")) await page.getByRole("heading", { name: "Sign in" }).waitFor();
      await act(page);
    }
    await expect(page.getByText(shows).first()).toBeVisible();
    // The power chart is a lazy chunk: screenshot it drawn, not its placeholder. A longer
    // wait than usual: that chunk is one more request, and a loaded machine can stall it.
    await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
    // AGPL §13 (ADR-0018): the source link is reachable in every state, signed in or not.
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeVisible();

    await expectNoAxeViolations(page, testInfo);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

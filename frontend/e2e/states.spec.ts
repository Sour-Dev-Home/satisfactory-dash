import type { Page } from "@playwright/test";
import type { ScenarioName } from "../src/test/scenarios";
import { expect, reportAxe, test } from "./fixtures";

// Every UI state from ADR-0016 item 5, at 1440 and 390 px (the two projects): wait until the
// state is actually on screen, run axe (report-only), then compare a full-page screenshot.

async function signIn(page: Page) {
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("example-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}

interface StateCase {
  scenario: ScenarioName;
  /** Visible text that proves the state has rendered. */
  shows: string | RegExp;
  /** Extra steps before the check, e.g. submitting the login form. */
  act?: (page: Page) => Promise<void>;
}

const CASES: StateCase[] = [
  { scenario: "default", shows: "Total play time on this save" },
  { scenario: "loading", shows: "Checking session…" },
  { scenario: "login", shows: "Sign in" },
  { scenario: "login-failed", shows: "Invalid username or password", act: signIn },
  { scenario: "login-rate-limited", shows: "Try again later", act: signIn },
  { scenario: "no-servers", shows: "No game servers are configured." },
  { scenario: "server-picker", shows: "Choose a game server" },
  { scenario: "paused", shows: "Paused: no players connected, values are frozen." },
  { scenario: "stale", shows: /Showing last known data from/ },
  { scenario: "slow-tick", shows: /Slow \(/ },
  { scenario: "no-game", shows: "No save loaded" },
  { scenario: "outage", shows: /Power outage: 1 circuit has a tripped fuse/ },
  { scenario: "at-risk", shows: "1 circuit is at risk." },
  { scenario: "battery-charging", shows: /Charging 100 MW/ },
  { scenario: "battery-discharging", shows: /Discharging 80 MW/ },
  // The modded item has no unit, so it alone falls back to "per min" (ADR-0015).
  { scenario: "unknown-units", shows: /Modded Widget: .* per min/ },
  { scenario: "settings-read-only", shows: /Read-only: the backend has no verified admin token/ },
  { scenario: "settings-pending", shows: "Change pending: the server will apply it." },
  { scenario: "upstream-unreachable", shows: "Game server unreachable." },
  { scenario: "upstream-auth-rejected", shows: /credentials for the game server were rejected/ },
  { scenario: "upstream-invalid", shows: "The game server returned an error." },
  // The envelope's own message (the generic branch). "Request ID:" shows for every API error.
  { scenario: "unknown-error-code", shows: /^Something went wrong$/ },
  { scenario: "backend-unreachable", shows: "Couldn't reach the dashboard backend." },
  { scenario: "contract-drift", shows: /doesn't understand/ },
];

for (const { scenario, shows, act } of CASES) {
  test(`state: ${scenario}`, async ({ page, mockApi }, testInfo) => {
    await mockApi(scenario);
    await page.goto("/");
    if (act) {
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      await act(page);
    }
    await expect(page.getByText(shows).first()).toBeVisible();
    // AGPL §13 (ADR-0018): the source link is reachable in every state, signed in or not.
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeVisible();

    await reportAxe(page, testInfo);
    await expect(page).toHaveScreenshot(`${scenario}.png`, { fullPage: true });
  });
}

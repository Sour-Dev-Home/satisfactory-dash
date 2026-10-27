import type { Locator, Page } from "@playwright/test";
import { FALLBACK_STAGE } from "../src/planner/graph/viewport";
import type { ScenarioName } from "../src/test/scenarios";
import { expect, expectNoAxeViolations, settleAnimations, test } from "./fixtures";

// Every UI state from ADR-0016 item 5, at 1440 and 390 px (the two projects): wait until the
// state is actually on screen, fail on any axe violation, then compare a full-page screenshot.

async function signIn(page: Page) {
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("example-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Waits until the page has revealed and its slow panels are showing their skeletons. */
async function skeletonsShown(page: Page) {
  await expect(page.locator('[data-page-reveal="revealed"]')).toBeVisible();
  await expect(page.locator('[data-loading="shown"]').first()).toBeVisible();
}

/** Opens every folded Details on the metrics page, as a keyboard user would, one summary at a time. */
async function openAllDetails(page: Page) {
  const summaries = page.locator("[data-details] > summary");
  await expect(summaries.first()).toBeVisible();
  for (const summary of await summaries.all()) {
    await summary.focus();
    await page.keyboard.press("Enter");
  }
}

const openIronSite =(page: Page) => page.getByRole("button", { name: "Open site: Iron Plate site" }).click();

/** The Iron Plate factory (ADR-0055) on its tables, whichever view the screen opens on. */
async function openPlateFactoryTables(page: Page) {
  await pressButton(page, "Open factory: Iron Plate factory");
  await page.getByRole("button", { name: "Tables" }).click();
}

/** ADR-0055 #727: the factory cards (Tables), both ticked for a merge. */
async function pickBothFactories(page: Page) {
  await page.getByRole("button", { name: "Tables" }).click();
  await page.getByRole("checkbox", { name: "Select Rod works" }).check();
  await page.getByRole("checkbox", { name: "Select Iron Plate factory" }).check();
}

/** Both ticked, then merged under the proposed name. */
async function mergeBothFactories(page: Page) {
  await pickBothFactories(page);
  await page.getByRole("button", { name: "Merge into one" }).click();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
}

/** A visually hidden button (the canvas's keyboard way into a card), reached as a keyboard user does. */
async function pressButton(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name }).focus();
  await page.keyboard.press("Enter");
}

/** The Iron Plate factory (ADR-0055 PR 8) on its canvas, whichever view the screen opens on. */
async function openPlateFactoryGraph(page: Page) {
  await pressButton(page, "Open factory: Iron Plate factory");
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("img", { name: /^Graph of Iron Plate factory/ })).toBeVisible();
}

/** The Iron Plate site on the graph view, whichever view the screen opens on. */
/**
 * Waits until the canvas has measured itself: its viewBox leaves `FALLBACK_STAGE` once the ResizeObserver reports. A
 * visible SVG is not enough: a card focused before then is revealed against the fallback stage, and the view after it
 * (and so the screenshot) depends on that race.
 */
async function canvasMeasured(svg: Locator) {
  await expect(svg).toBeVisible();
  await expect(svg).not.toHaveAttribute("viewBox", `0 0 ${FALLBACK_STAGE.width} ${FALLBACK_STAGE.height}`);
}

async function openIronGraph(page: Page) {
  await openIronSite(page);
  await page.getByRole("button", { name: "Graph" }).click();
  await canvasMeasured(page.getByRole("img", { name: /^Graph of Iron Plate site/ }));
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
   * The fixed "now" (ISO) for this state (default LIVE_NOW). Anything drawn from the clock, such as
   * "Updated 8 s ago" or the mute field's default of an hour ahead, then reads the same every run.
   */
  clock?: string;
  /**
   * What the browser says about web push: not asked yet ("off"), already subscribed, or notifications blocked.
   * Always stubbed for these states: headless Chromium reports its own permission ("denied" in CI).
   */
  browser?: "off" | "subscribed" | "denied";
  /**
   * A locator that must be visible before the screenshot, for a state whose reads all answer late: the "no chart
   * placeholder" wait below passes before a slow history read has even mounted the placeholder.
   */
  ready?: string;
  /** A viewport width for a layout between the two projects' (#593); runs in the desktop project only. */
  width?: number;
}

/** Stands in for the browser's push state before the page loads. */
async function stubPushBrowser(page: Page, state: "off" | "subscribed" | "denied") {
  await page.addInitScript((s) => {
    const permission = s === "denied" ? "denied" : s === "subscribed" ? "granted" : "default";
    Object.defineProperty(Notification, "permission", { get: () => permission });
    if (s === "subscribed") {
      ServiceWorkerContainer.prototype.getRegistration = () =>
        Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({}) } } as unknown as ServiceWorkerRegistration);
    }
  }, state);
}

/** The fixtures' own day, for the alert settings (their mute and alert times). */
const FIXTURE_NOW = "2026-09-26T12:00:00.000Z";
/** Eight seconds after the live fixtures were observed: every view reads "Updated 8 s ago". */
const LIVE_NOW = "2026-09-22T22:25:12.000Z";
/** Eight seconds after the planner fixtures were observed. */
const PLANNER_NOW = "2026-10-23T15:05:08.000Z";
/** The same for the factories fixture (ADR-0055). */
const FACTORIES_NOW = "2026-10-24T12:00:08.000Z";
/** 8 s after the agent fixtures' last-seen time, so "Last seen 8 s ago" holds still. */
const AGENT_NOW = "2026-09-26T12:00:13.000Z";

/** Three minutes after the pairing fixture's request: "asked 3 minutes ago". */
const PAIR_NOW = "2026-10-25T12:03:00.000Z";

/** The /pair page (ADR-0051): types the code in lower case without dashes (it normalises) and continues. */
const lookUpCode = async (page: Page) => {
  await page.getByLabel("Pairing code").fill("ab3d7xq2k5mn");
  await page.getByRole("button", { name: "Continue" }).click();
};
const lookUpAndChooseExisting = async (page: Page) => {
  await lookUpCode(page);
  await page.getByLabel("One of my servers").check();
};
const lookUpAndApprove = async (page: Page) => {
  await lookUpCode(page);
  await page.getByRole("button", { name: "Approve" }).click();
};

/** "Add your server" (ADR-0046): types a name and submits. */
const addYourServer = (name: string) => async (page: Page) => {
  await page.getByLabel("Server name").fill(name);
  await page.getByRole("button", { name: "Add server" }).click();
};

/** Settings → Delete my account (ADR-0047): opens the confirm and confirms it. */
const deleteMyAccount = async (page: Page) => {
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByRole("button", { name: "Delete my account", exact: true }).click();
};

const CASES: StateCase[] = [
  { scenario: "default", shows: "Total play time on this save" },
  { scenario: "default", name: "default-power", path: "/app/power", shows: /Circuit 0/ },
  { scenario: "default", name: "default-factory", path: "/app/factory", shows: /machines · .* backed up/ },
  { scenario: "default", name: "default-settings", path: "/app/settings", shows: /Auto-pause when no players/ },
  { scenario: "loading", shows: "Checking session…" },
  // The panels' skeletons (#494), held on screen by reads that never answer: shaped like their
  // panels, with no loading text to read. The page has revealed by then, so the clocks have run.
  { scenario: "loading-panels", name: "loading-factory", path: "/app/factory", shows: "Factory", act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-map", path: "/app/map", shows: "Map", act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-power", path: "/app/power", shows: /Circuit 0/, act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-settings", path: "/app/settings", shows: /Auto-pause when no players/, act: skeletonsShown },
  // Every read answers after 800 ms, past the page budget: the settled page is the same as the default's.
  { scenario: "slow-queries", name: "slow-overview", shows: "Total play time on this save" },
  { scenario: "slow-queries", name: "slow-power", path: "/app/power", shows: /Circuit 0/, ready: ".power-chart .uplot" },
  { scenario: "slow-queries", name: "slow-factory", path: "/app/factory", shows: /machines · .* backed up/ },
  { scenario: "slow-queries", name: "slow-settings", path: "/app/settings", shows: /Auto-pause when no players/ },
  // The map's world layers (ADR-0038 M5): nothing read yet, one cut to its cap, and the read failing.
  { scenario: "map-world-empty", path: "/app/map", shows: "No rails built yet." },
  { scenario: "map-world-truncated", path: "/app/map", shows: /Showing part of the rails/ },
  { scenario: "map-world-error", path: "/app/map", shows: "Retry" },
  // The players' map markers (#330) are empty and failing in the two cases above; here, cut to the layer's cap.
  { scenario: "map-markers-truncated", path: "/app/map", shows: /Showing part of the markers/ },
  // The power lines (#330) are off by default, so each of their states turns them on: drawn, none built yet, cut to the
  // layer's cap, and the read failing.
  { scenario: "default", name: "map-power-lines", path: "/app/map", shows: "2 power lines on the map, 243 m of wire in all.", act: showPowerLines },
  { scenario: "map-power-lines-empty", path: "/app/map", shows: "No power lines built yet.", act: showPowerLines },
  { scenario: "map-power-lines-truncated", path: "/app/map", shows: /Showing part of the power lines/, act: showPowerLines },
  { scenario: "map-power-lines-error", path: "/app/map", shows: /Power lines couldn't load/, act: showPowerLines },
  // The live trains (ADR-0038 M6): none built yet, the game unreachable (last known positions), and the read failing.
  { scenario: "map-live-empty", path: "/app/map", shows: "No trains or stations built yet." },
  { scenario: "map-live-stale", path: "/app/map", shows: /last known train positions/ },
  { scenario: "map-live-error", path: "/app/map", shows: /Trains couldn't load/ },
  // The map's Filters (2026-10-21): open, with one in-view resource type and one building state hidden, in-use nodes only.
  { scenario: "default", name: "map-filtered", path: "/app/map", shows: /^\d+ of \d+ resource nodes shown/, act: filterTheMap },
  { scenario: "login", shows: "Sign in" },
  { scenario: "login-google", shows: "Sign in with Google" },
  {
    scenario: "login-google-error",
    path: "/app/login?error=not_invited",
    shows: "This Google account hasn't been invited yet. Ask the server's owner for an invitation.",
  },
  { scenario: "login-terms-changed", path: "/app/login?error=terms_changed", shows: "What changed:" },
  { scenario: "login-failed", shows: "Invalid username or password", act: signIn },
  { scenario: "login-rate-limited", shows: "Try again later", act: signIn },
  { scenario: "no-servers", shows: "No game servers are configured." },
  { scenario: "server-picker", shows: "Choose a game server" },
  // The Overview says "paused" in its Server row; the banner is on the other pages only.
  { scenario: "paused", shows: "Paused: no players connected" },
  { scenario: "paused", name: "paused-power", path: "/app/power", shows: "Paused: no players connected, values are frozen." },
  { scenario: "stale", shows: /Showing last known data from/ },
  // ADR-0052: the game is down, the last reading stays, dimmed, under a banner with when it went down.
  { scenario: "unreachable-last-data", shows: /Game server unreachable since/ },
  { scenario: "unreachable-last-data", name: "unreachable-last-data-power", path: "/app/power", shows: /Game server unreachable since/ },
  { scenario: "unreachable-last-data", name: "unreachable-last-data-factory", path: "/app/factory", shows: /Game server unreachable since/ },
  // ADR-0057: a vanilla-only server; the game's own facts on the Overview, and the one notice in place of power.
  { scenario: "basic-data", shows: /Basic data:/ },
  { scenario: "basic-data", name: "basic-data-power", path: "/app/power", shows: /Basic data:/ },
  // 1024 px, where the Health card is at its narrowest beside Players: a long status word must never sit
  // under the tick gauge (#593).
  { scenario: "default", name: "default-narrow-desktop", shows: "Total play time on this save", width: 1024 },
  { scenario: "stale", name: "stale-narrow-desktop", shows: /Showing last known data from/, width: 1024 },
  // The Health card's tick bar and line (the red zone is below 10 ticks/s).
  { scenario: "slow-tick", shows: "8.2/s" },
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
  // ADR-0048 (#349), the Factory page's Bottlenecks section (the default scenario shows findings with a belt cap).
  { scenario: "default", name: "bottlenecks-belt-cap", path: "/app/factory", shows: /Capped by: Conveyor Belt Mk.1/ },
  { scenario: "bottlenecks-old-frm", path: "/app/factory", shows: /Update FRM to 1.5.4/ },
  { scenario: "bottlenecks-too-large", path: "/app/factory", shows: /connection data is too large/ },
  { scenario: "bottlenecks-not-received", path: "/app/factory", shows: /agent hasn't sent belt data yet/ },
  { scenario: "bottlenecks-empty", path: "/app/factory", shows: /No bottlenecks/ },
  { scenario: "bottlenecks-unknown-kind", path: "/app/factory", shows: /smart splitter upstream filters Limestone/ },
  // ADR-0050 task 5, the Planner page. The fixtures were observed at
  // PLANNER_NOW minus 8 s, so the age reads the same every run.
  { scenario: "default", name: "planner-sites", path: "/app/planner", shows: "Iron Plate site", clock: PLANNER_NOW },
  {
    scenario: "default",
    name: "planner-site-detail",
    path: "/app/planner",
    shows: /Connections/,
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronSite(page);
      await page.getByRole("button", { name: "Tables" }).click();
    },
  },
  // ADR-0050 task 6, the graph. A site opens on the graph at 1440 px and on the tables at 390 px (Decision 4).
  {
    scenario: "default",
    name: "planner-site-default-view",
    path: "/app/planner",
    shows: /^(Zoom in|Connections)$/,
    clock: PLANNER_NOW,
    act: openIronSite,
  },
  { scenario: "default", name: "planner-graph", path: "/app/planner", shows: "Fit to view", clock: PLANNER_NOW, act: openIronGraph },
  // The item filter with something to dim: no recycle loop, so Iron Ingot leaves the recycler out ("4 of 5 groups").
  {
    scenario: "planner-filter-dimmed",
    name: "planner-graph-filtered",
    path: "/app/planner",
    shows: /4 of 5 groups carry or feed this item/,
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronGraph(page);
      await page.getByRole("combobox", { name: "Item" }).selectOption({ label: "Iron Ingot" });
    },
  },
  {
    scenario: "planner-group-panel",
    name: "planner-group-panel",
    path: "/app/planner",
    shows: /Iron Plate: 9 \/ 20 items\/min/,
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronGraph(page);
      // The group's button is visually hidden (the keyboard's way in): reach it as a keyboard user does.
      await page.getByRole("button", { name: /^8× Constructor, Iron Plate/ }).focus();
      await page.keyboard.press("Enter");
    },
  },
  // #728 step 2: a stalled group's card reads "Iron Plate · 0 of 160/min" with a muted "Backed up" line, and its side
  // panel "0 of 160 items/min · backed up".
  { scenario: "planner-stalled", name: "planner-stalled-graph", path: "/app/planner", shows: "Fit to view", clock: PLANNER_NOW, act: openIronGraph },
  {
    scenario: "planner-stalled",
    name: "planner-stalled-panel",
    path: "/app/planner",
    // Anchored: the canvas's hidden <title> holds the same words after the group's name, and comes first.
    shows: /^Iron Plate: 0 of 160 items\/min · backed up$/,
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronGraph(page);
      await page.getByRole("button", { name: /^8× Constructor, Iron Plate/ }).focus();
      await page.keyboard.press("Enter");
    },
  },
  // ADR-0055 PR 7: factories as the first level, an opened factory's tables, and the trees of a recipe in one bubble.
  // The overview is the canvas from 640 px and the cards with the flows table below (ADR-0055 PR 8).
  { scenario: "planner-factories", path: "/app/planner", shows: /^(Flows between factories|Zoom in)$/, clock: FACTORIES_NOW },
  // PR 8a: an opened factory on the canvas, and a tree opened in place and folded again.
  {
    scenario: "planner-factories",
    name: "planner-factory-canvas",
    path: "/app/planner",
    shows: "Fit to view",
    clock: FACTORIES_NOW,
    act: openPlateFactoryGraph,
  },
  {
    scenario: "planner-factories-trees",
    name: "planner-factory-bubble-open",
    path: "/app/planner",
    shows: "Collapse",
    clock: FACTORIES_NOW,
    act: openPlateFactoryGraph,
  },
  {
    scenario: "planner-factories-trees",
    name: "planner-factory-bubble-folded",
    path: "/app/planner",
    shows: /^×\d+$/,
    clock: FACTORIES_NOW,
    act: async (page) => {
      await openPlateFactoryGraph(page);
      await pressButton(page, "Collapse 5× Constructor, Iron Plate, tree 1 of 2");
    },
  },
  // PR 8b: what only feeds a card hidden behind a count, storage folded into chips, and one transport of every mode.
  {
    scenario: "planner-factories",
    name: "planner-factory-upstream-hidden",
    path: "/app/planner",
    shows: "+1",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await openPlateFactoryGraph(page);
      await pressButton(page, "Hide 1 group that only feeds Storage Container");
    },
  },
  {
    scenario: "planner-factories",
    name: "planner-factory-storage-folded",
    path: "/app/planner",
    shows: "1 flow to storage",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await openPlateFactoryGraph(page);
      await page.getByRole("button", { name: "Storage detail" }).click();
    },
  },
  {
    scenario: "planner-factories-transports",
    name: "planner-factory-transports",
    path: "/app/planner",
    shows: "Fit to view",
    clock: FACTORIES_NOW,
    act: openPlateFactoryGraph,
  },
  {
    scenario: "planner-factories",
    name: "planner-factory-detail",
    path: "/app/planner",
    shows: /Connections/,
    clock: FACTORIES_NOW,
    act: openPlateFactoryTables,
  },
  {
    scenario: "planner-factories-trees",
    name: "planner-factory-trees",
    path: "/app/planner",
    shows: /tree 1 of 2/,
    clock: FACTORIES_NOW,
    act: openPlateFactoryTables,
  },
  // ADR-0055 PR 10a: designated factories in the text form. The overview opens on the canvas from 640 px, so each asks for the cards.
  {
    scenario: "planner-designations",
    name: "planner-designated",
    path: "/app/planner",
    shows: /1 machine no longer found/,
    clock: FACTORIES_NOW,
    act: (page) => page.getByRole("button", { name: "Tables" }).click(),
  },
  {
    scenario: "planner-designations",
    name: "planner-suggestions",
    path: "/app/planner",
    shows: "Suggestion",
    clock: FACTORIES_NOW,
    act: (page) => page.getByRole("button", { name: "Reason factories for me" }).click(),
  },
  {
    scenario: "planner-designations",
    name: "planner-designate-form",
    path: "/app/planner",
    shows: "Designate",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await openPlateFactoryTables(page);
      await page.getByRole("checkbox", { name: "Select Smelter" }).check();
      await page.getByRole("button", { name: "Designate selected" }).click();
    },
  },
  // ADR-0055 #727: merge and split. Two factories picked (Merge offered), the same with nothing between them (Merge
  // disabled with its reason), a merge done (the undo offer), a stale merge, and the split bar inside a designated factory.
  {
    scenario: "planner-merge-split",
    name: "planner-merge-bar",
    path: "/app/planner",
    shows: "2 factories selected",
    clock: FACTORIES_NOW,
    act: pickBothFactories,
  },
  {
    scenario: "planner-merge-apart",
    name: "planner-merge-disabled",
    path: "/app/planner",
    shows: "These factories are not connected by any belt, pipe or transport",
    clock: FACTORIES_NOW,
    act: pickBothFactories,
  },
  {
    scenario: "planner-merge-split",
    name: "planner-merge-undo",
    path: "/app/planner",
    shows: "Merged 2 factories into Iron Plate factory.",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await mergeBothFactories(page);
      // The undo offer is sticky to the viewport's foot. At 390 px it sticks mid-page, and a full-page screenshot of
      // a stuck element never settles. At the page's end it sits in its own place, as on desktop.
      await page.getByText("Merged 2 factories into Iron Plate factory.").first().waitFor();
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    },
  },
  {
    scenario: "planner-merge-stale",
    name: "planner-merge-stale",
    path: "/app/planner",
    shows: "Changed by someone else; select again.",
    clock: FACTORIES_NOW,
    act: mergeBothFactories,
  },
  {
    scenario: "planner-merge-split",
    name: "planner-split-bar",
    path: "/app/planner",
    shows: "1 group, 2 machines selected",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await pressButton(page, "Open factory: Rod works");
      await page.getByRole("button", { name: "Tables" }).click();
      await page.getByRole("checkbox", { name: "Select Constructor" }).check();
    },
  },
  { scenario: "planner-bottlenecks", path: "/app/planner", shows: /1 bottleneck/, clock: PLANNER_NOW },
  { scenario: "planner-empty", path: "/app/planner", shows: /No sites yet/, clock: PLANNER_NOW },
  { scenario: "planner-old-frm", path: "/app/planner", shows: /Update FRM to 1.5.4/, clock: PLANNER_NOW },
  { scenario: "planner-too-large", path: "/app/planner", shows: /connection data is too large/, clock: PLANNER_NOW },
  { scenario: "planner-not-received", path: "/app/planner", shows: /agent hasn't sent belt data yet/, clock: PLANNER_NOW },
  { scenario: "planner-stale", path: "/app/planner", shows: /Showing last known planner data from/, clock: PLANNER_NOW },
  { scenario: "planner-error", path: "/app/planner", shows: "Game server unreachable.", clock: PLANNER_NOW },
  // The skeleton has no text of its own to match, so the shell's nav tab.
  { scenario: "loading-panels", name: "loading-planner", path: "/app/planner", shows: "Overview", act: skeletonsShown },
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
  // ADR-0054 D4: a deploy gap (Cloudflare's 530 page) says "updating" once, not "couldn't reach the backend".
  { scenario: "deploy-gap", shows: "The dashboard is updating, back in a moment." },
  // The panels with no data say "Updating…" (calm, no alert) while the gap is recent, not "Couldn't load".
  { scenario: "deploy-gap", name: "deploy-gap-power", path: "/app/power", shows: "Updating…" },
  { scenario: "contract-drift", shows: /doesn't understand/ },
  // Server management (ADR-0030), operator only: the three stored states, then the add form's refusals.
  { scenario: "servers-manage", path: "/app/servers", shows: "This server's saved address isn't allowed. Edit the host or remove it." },
  { scenario: "servers-manage", name: "servers-add-form", path: "/app/servers", shows: "Leave blank if FRM runs without a token.", act: openAddForm },
  // ADR-0031: a server read through the game PC's agent (#266), and its switch back to local (#273).
  { scenario: "servers-with-agent", path: "/app/servers", shows: /read through the game PC's agent/ },
  {
    scenario: "servers-with-agent",
    name: "servers-switch-to-local",
    path: "/app/servers",
    shows: /tested first and nothing changes if it fails/,
    act: (page) => page.getByRole("button", { name: "Switch back to local for Factory two" }).click(),
  },
  { scenario: "servers-first", shows: "No game servers yet. Add the first one; for now it has to run on this machine." },
  // The operator's metrics page (ADR-0056): every table filled, each section's reason for having no data, a 429, a
  // failing read, the loading skeleton, and a user who isn't the operator (the unknown-page redirect lands on the Overview).
  // Chart-led since the 2026-10-26 amendment: the headline tiles and trends, then every folded Details opened (the text
  // path, axe-checked), and an older backend without charts.
  { scenario: "metrics", path: "/app/metrics", shows: "Requests per hour, by status class" },
  { scenario: "metrics", name: "metrics-details", path: "/app/metrics", shows: /Timings are bucket upper bounds/, act: openAllDetails },
  { scenario: "metrics-no-charts", path: "/app/metrics", shows: /Charts not available yet/ },
  { scenario: "metrics-unavailable", path: "/app/metrics", shows: "The daily delivery feed isn't set up on this backend." },
  { scenario: "metrics-rate-limited", path: "/app/metrics", shows: /asked for too often/ },
  { scenario: "metrics-error", path: "/app/metrics", shows: "Retry" },
  { scenario: "metrics-forbidden", path: "/app/metrics", shows: "Total play time on this save" },
  { scenario: "metrics-loading", path: "/app/metrics", shows: "Refresh", act: skeletonsShown },
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
  // ADR-0044 web push, Settings → Alerts. "default-settings" is the backend with push off. Here it is on,
  // and the browser is as it comes (permission not asked yet), already subscribed, or has blocked
  // notifications; and a viewer, who gets the opt-in like anyone.
  { scenario: "push-enabled", path: "/app/settings", shows: /This device is not subscribed/, clock: FIXTURE_NOW, browser: "off" },
  { scenario: "push-opted-in", name: "push-subscribed", path: "/app/settings", shows: /This device is subscribed/, clock: FIXTURE_NOW, browser: "subscribed" },
  { scenario: "push-enabled", name: "push-denied", path: "/app/settings", shows: /Notifications are blocked for this site/, clock: FIXTURE_NOW, browser: "denied" },
  { scenario: "push-viewer", path: "/app/settings", shows: /It applies to every device where push is on/, clock: FIXTURE_NOW, browser: "off" },
  // Settings → Game PC agent (ADR-0031 PR 7). The clock sits 8 s after the agent was last heard.
  { scenario: "agent-local-operator", path: "/app/settings", shows: /forgets its stored game-server tokens/, clock: AGENT_NOW },
  {
    scenario: "agent-local-operator",
    name: "agent-code",
    path: "/app/settings",
    shows: "AB3D-7XQ2-K5MN",
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Create enrolment code" }).click(),
  },
  { scenario: "agent-enrolled-owner", path: "/app/settings", shows: "Last seen 8 s ago", clock: AGENT_NOW },
  {
    scenario: "agent-enrolled-owner",
    name: "agent-revoke-confirm",
    path: "/app/settings",
    shows: /until an agent is enrolled again/,
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Revoke…" }).click(),
  },
  { scenario: "agent-silent-owner", path: "/app/settings", shows: /Hasn't reported yet/, clock: AGENT_NOW },
  // ADR-0057 Decision 7: the version banners in the shell (an update, an unsupported version, a security advisory from the
  // policy's range and from minSafe) and the line on the Servers page.
  { scenario: "update-agent", path: "/app/settings", shows: /Update available: the game PC agent is 0\.3\.5/, clock: AGENT_NOW },
  { scenario: "update-mod", path: "/app/settings", shows: /applies at the next server restart/, clock: AGENT_NOW },
  { scenario: "update-unsupported", path: "/app/settings", shows: /Unsupported version/, clock: AGENT_NOW },
  { scenario: "update-advisory", path: "/app/settings", shows: /Security advisory \(SD-2026-001\)/, clock: AGENT_NOW },
  { scenario: "update-min-safe", path: "/app/settings", shows: /Security advisory: This version has a known security problem/, clock: AGENT_NOW },
  { scenario: "update-servers", path: "/app/servers", shows: /Update available: the game PC agent is 0\.3\.5/, clock: AGENT_NOW },
  // Self-serve (ADR-0046, #529). Settings → Add your server (on; off shows no section), the add form as the whole
  // screen for a player with no server, each refusal, and the owner of an enrolled and of a pending server.
  { scenario: "self-serve-add", path: "/app/settings", shows: "Add your server", clock: AGENT_NOW },
  { scenario: "self-serve-off", path: "/app/settings", shows: /Auto-pause when no players/, clock: AGENT_NOW },
  { scenario: "self-serve-empty", path: "/app", shows: "Add your first server", clock: AGENT_NOW },
  {
    scenario: "self-serve-limit-account",
    path: "/app/settings",
    shows: /one account can have at most 2/,
    clock: AGENT_NOW,
    act: addYourServer("Second world"),
  },
  {
    scenario: "self-serve-limit-pending",
    path: "/app/settings",
    shows: /with its enrolment code before adding another/,
    clock: AGENT_NOW,
    act: addYourServer("Second world"),
  },
  {
    scenario: "self-serve-limit-service",
    path: "/app/settings",
    shows: /The service is full right now/,
    clock: AGENT_NOW,
    act: addYourServer("Second world"),
  },
  {
    scenario: "self-serve-limit-daily",
    path: "/app/settings",
    shows: /Try again in about 5 hours/,
    clock: AGENT_NOW,
    act: addYourServer("Second world"),
  },
  // The /pair page (ADR-0051 section 1): the code field, the confirmation, re-pairing one of your own, done, and each refusal.
  { scenario: "pair", path: "/app/pair", shows: "Twelve letters and digits", clock: PAIR_NOW },
  { scenario: "pair", name: "pair-confirm", path: "/app/pair", shows: "asked 3 minutes ago", clock: PAIR_NOW, act: lookUpCode },
  {
    scenario: "pair",
    name: "pair-existing",
    path: "/app/pair",
    shows: /This replaces that server's credential/,
    clock: PAIR_NOW,
    act: lookUpAndChooseExisting,
  },
  { scenario: "pair", name: "pair-done", path: "/app/pair", shows: "Paired. Data arrives within a few seconds.", clock: PAIR_NOW, act: lookUpAndApprove },
  { scenario: "pair-invalid", path: "/app/pair", shows: /That code isn't valid/, clock: PAIR_NOW, act: lookUpCode },
  { scenario: "pair-rate-limited", path: "/app/pair", shows: /Wait about 2 minutes/, clock: PAIR_NOW, act: lookUpCode },
  { scenario: "pair-forbidden", path: "/app/pair", shows: /isn't available to your account/, clock: PAIR_NOW, act: lookUpCode },
  { scenario: "self-serve-owner", path: "/app/settings", shows: "Your server", clock: AGENT_NOW },
  { scenario: "self-serve-owner-pending", path: "/app/settings", shows: /Create an enrolment code above to connect it/, clock: AGENT_NOW },
  {
    scenario: "self-serve-owner",
    name: "self-serve-rename",
    path: "/app/settings",
    shows: "Save name",
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Rename My first world" }).click(),
  },
  {
    scenario: "self-serve-owner",
    name: "self-serve-delete-confirm",
    path: "/app/settings",
    shows: /can.t be undone/,
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Remove My first world from Satisfactory Dash" }).click(),
  },
  // ADR-0047 (#311 task 3): Settings → Delete my account, its confirm, its two refusals, and leaving a server.
  { scenario: "account-delete", path: "/app/settings", shows: "Removed with your account", clock: AGENT_NOW },
  {
    scenario: "account-delete",
    name: "account-delete-confirm",
    path: "/app/settings",
    shows: "Delete your account now?",
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Delete my account…" }).click(),
  },
  { scenario: "account-reauth", path: "/app/settings", shows: "Sign in again with Google", clock: AGENT_NOW, act: deleteMyAccount },
  {
    scenario: "account-operator-servers",
    path: "/app/settings",
    shows: "They need a new owner first. Contact the operator.",
    clock: AGENT_NOW,
    act: deleteMyAccount,
  },
  {
    scenario: "account-leave",
    path: "/app/settings",
    shows: "Leave Satisfactory server?",
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Leave this server…" }).click(),
  },
  { scenario: "agent-enrolled-viewer", path: "/app/settings", shows: "Only a server owner or admin can enrol or revoke the agent.", clock: AGENT_NOW },
  // The command bar (#351), open over the Overview: a native modal dialog, so the CSP guard here
  // also proves it injects no <style> (ADR-0016 item 8).
  {
    scenario: "default",
    name: "command-bar",
    // A command's text: the search box's placeholder isn't text getByText can find.
    shows: "Game PC agent",
    act: async (page) => {
      await page.getByRole("heading", { name: "Health" }).waitFor();
      await page.keyboard.press("Control+K");
      await page.getByRole("combobox").waitFor();
    },
  },
];

async function filterTheMap(page: Page) {
  await page.getByText("Filters", { exact: true }).click();
  // Coal and Iron Ore (both in use) sit in the factory's first view; the others are off screen. Hiding Coal and
  // keeping "In use only" leaves the Iron Ore node in view, so the screenshot shows the filtered subset.
  await page.getByRole("checkbox", { name: /^Coal/ }).uncheck();
  await page.getByRole("radio", { name: "In use only" }).check();
  await page.getByRole("checkbox", { name: /^Paused/ }).uncheck();
}

async function showPowerLines(page: Page) {
  await page.getByRole("checkbox", { name: "Power lines" }).check();
}

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

for (const { scenario, shows, path = "/app", name = scenario, act, clock, browser, ready, width } of CASES) {
  test(`state: ${name}`, async ({ page, mockApi }, testInfo) => {
    test.skip(width !== undefined && testInfo.project.name !== "desktop", "one narrow-desktop width is enough");
    if (width !== undefined) await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 900 });
    await mockApi(scenario);
    if (browser) await stubPushBrowser(page, browser);
    // Date.now() is fixed for every state; timers still run, so polling and React behave as usual.
    await page.clock.setFixedTime(clock ?? LIVE_NOW);
    // Reduced motion also turns off Leaflet's zoom and fade animations, so every map screenshot is stable.
    // The planner canvas's transport glyphs move unless the operator asks for reduced motion, so they sit still here too.
    if (path === "/app/map" || path === "/app/planner") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    if (act) {
      // Sign-in states act on the login form once it's there; the rest act on their page, and
      // Playwright's actions wait for their own element.
      if (scenario.startsWith("login")) await page.getByRole("heading", { name: "Sign in" }).waitFor();
      await act(page);
    }
    await expect(page.getByText(shows).first()).toBeVisible();
    if (ready) await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
    // The power chart is a lazy chunk: screenshot it drawn, not its placeholder. A longer
    // wait than usual: that chunk is one more request, and a loaded machine can stall it.
    await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
    // AGPL §13 (ADR-0018): the source link is reachable in every state, signed in or not.
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeVisible();

    await expectNoAxeViolations(page, testInfo);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

// #616: the age badge's label changes, nothing in the Health card moves.
test("the Health card keeps its layout as the status ages", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.clock.setFixedTime(LIVE_NOW);
  await page.goto("/app");
  const card = page.getByRole("region", { name: "Health" });
  const badge = card.locator("[data-age-label]");
  await expect(badge).toHaveText("live");
  // Measured once the page's entrance animations end: mid-reveal the card is still sliding by a fraction of a pixel.
  const boxes = async () => {
    await settleAnimations(page);
    return [
      await card.getByRole("heading", { name: "Health" }).boundingBox(),
      await card.locator("[data-age]").boundingBox(),
      await card.locator("svg[data-gauge]").boundingBox(),
      await card.boundingBox(),
    ];
  };
  const before = await boxes();
  await page.clock.setFixedTime(new Date(Date.parse(LIVE_NOW) + 195_000).toISOString());
  await expect(badge).toHaveText("3 min");
  expect(await boxes()).toEqual(before);
});

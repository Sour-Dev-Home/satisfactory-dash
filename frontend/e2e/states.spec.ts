import type { Locator, Page } from "@playwright/test";
import { FALLBACK_STAGE } from "../src/planner/graph/viewport";
import type { ScenarioName } from "../src/test/scenarios";
import { expect, expectNoAxeViolations, paintLazyRows, settleAnimations, test } from "./fixtures";

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

/** The Iron Plate factory (ADR-0055) on its outline (ADR-0062 Decision 3), whichever view the screen opens on. */
async function openPlateFactoryOutline(page: Page) {
  await pressButton(page, "Open factory: Iron Plate factory");
  await page.getByRole("button", { name: "Outline" }).click();
}

/** ADR-0055 #727: the factories in the outline, both selected for a merge (each row's Select button). */
async function pickBothFactories(page: Page) {
  await page.getByRole("button", { name: "Outline" }).click();
  await page.getByRole("button", { name: "Select Rod works", exact: true }).click();
  await page.getByRole("button", { name: "Select Iron Plate factory", exact: true }).click();
}

/** Both ticked, then merged under the proposed name. */
async function mergeBothFactories(page: Page) {
  await pickBothFactories(page);
  await page.getByRole("button", { name: "Merge into one" }).click();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
}

/**
 * ADR-0064: the bottleneck card's full list opens in place. A click, not a `#bottlenecks` link: the link's jump focuses and
 * scrolls whenever the read lands, which made the screenshots differ run to run; a mouse click leaves no focus ring.
 */
async function openBottlenecks(page: Page) {
  const button = page.getByRole("button", { name: "Full list of bottlenecks" });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/**
 * ADR-0064: the folded machine table, the Iron Plate factory and then one of its groups opened. Then back to the top with
 * the mouse away: a click scrolls the button into view, and a full-page screenshot taken scrolled caught the phone's sticky
 * search row at a different place each time ("two consecutive stable screenshots" failed).
 */
async function openGroup(page: Page, group: string) {
  await page.getByRole("button", { name: "Iron Plate factory", exact: true }).click();
  const button = page.getByRole("button", { name: group, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A visually hidden button (the canvas's keyboard way into a card), reached as a keyboard user does. */
async function pressButton(page: Page, name: string | RegExp) {
  // Visible first: the page reveals at once (PageReveal), and focus() on a control still under `invisible` lands nowhere,
  // so Enter went to the body (planner-nested-level on a phone). A visually hidden button still has a 1px box.
  const button = page.getByRole("button", { name });
  await expect(button).toBeVisible();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}

/** The Iron Plate factory (ADR-0055 PR 8) on its canvas, whichever view the screen opens on. */
async function openPlateFactoryGraph(page: Page) {
  await pressButton(page, "Open factory: Iron Plate factory");
  await page.getByRole("button", { name: "Graph", exact: true }).click();
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
  await page.getByRole("button", { name: "Graph", exact: true }).click();
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
  /** localStorage set before the page loads, e.g. a feature flag that has no control yet. */
  storage?: Readonly<Record<string, string>>;
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
  { scenario: "default", shows: / played$/ },
  { scenario: "default", name: "default-power", path: "/app/power", shows: / MW capacity$/ },
  { scenario: "default", name: "default-factory", path: "/app/factory", shows: "Search machines" },
  { scenario: "default", name: "default-settings", path: "/app/settings", shows: /Auto-pause when no players/ },
  { scenario: "loading", shows: "Checking session…" },
  // The panels' skeletons (#494), held on screen by reads that never answer: shaped like their
  // panels, with no loading text to read. The page has revealed by then, so the clocks have run.
  { scenario: "loading-panels", name: "loading-factory", path: "/app/factory", shows: "Factory", act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-map", path: "/app/map", shows: "Map", act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-power", path: "/app/power", shows: / MW capacity$/, act: skeletonsShown },
  { scenario: "loading-panels", name: "loading-settings", path: "/app/settings", shows: /Auto-pause when no players/, act: skeletonsShown },
  // Every read answers after 800 ms, past the page budget: the settled page is the same as the default's.
  { scenario: "slow-queries", name: "slow-overview", shows: / played$/ },
  { scenario: "slow-queries", name: "slow-power", path: "/app/power", shows: / MW capacity$/, ready: ".power-chart .uplot" },
  { scenario: "slow-queries", name: "slow-factory", path: "/app/factory", shows: "Search machines" },
  { scenario: "slow-queries", name: "slow-settings", path: "/app/settings", shows: /Auto-pause when no players/ },
  // The map's world layers (ADR-0038 M5): nothing read yet, one cut to its cap, and the read failing.
  { scenario: "map-world-empty", path: "/app/map", shows: "No rails built yet." },
  { scenario: "map-world-truncated", path: "/app/map", shows: /Showing part of the rails/ },
  { scenario: "map-world-error", path: "/app/map", shows: "Retry" },
  // The players' map markers (#330) are empty and failing in the two cases above; here, cut to the layer's cap.
  { scenario: "map-markers-truncated", path: "/app/map", shows: /Showing part of the markers/ },
  // The drone ports (#330) are on by default, so empty and failing are in map-world-empty and -error; here, cut to the
  // layer's cap, and a pairing that names two ports (no route drawn, counted in the text).
  { scenario: "map-drone-ports-truncated", path: "/app/map", shows: /Showing part of the drone ports/ },
  { scenario: "map-drone-ports-ambiguous", path: "/app/map", shows: /1 pairing couldn't be matched to one port/ },
  // The power lines (#330) are off by default, so each of their states turns them on: drawn, none built yet, cut to the
  // layer's cap, and the read failing.
  { scenario: "default", name: "map-power-lines", path: "/app/map", shows: "2 power lines on the map, 243 m of wire in all.", act: showPowerLines },
  { scenario: "map-power-lines-empty", path: "/app/map", shows: "No power lines built yet.", act: showPowerLines },
  { scenario: "map-power-lines-truncated", path: "/app/map", shows: /Showing part of the power lines/, act: showPowerLines },
  { scenario: "map-power-lines-error", path: "/app/map", shows: /Power lines couldn't load/, act: showPowerLines },
  // The belts, lifts and pipes (#330) are off by default too: drawn (the captured sample), none reported yet, cut to the
  // layer's cap, and the read failing.
  { scenario: "default", name: "map-conveyors", path: "/app/map", shows: /^7 belts, 2 pipes, 2 lifts on the map, 30 m of belt/, act: showConveyors },
  { scenario: "map-conveyors-empty", path: "/app/map", shows: "No belts, lifts or pipes reported yet.", act: showConveyors },
  { scenario: "map-conveyors-truncated", path: "/app/map", shows: /Showing part of the belts and pipes/, act: showConveyors },
  { scenario: "map-conveyors-error", path: "/app/map", shows: /Belts and pipes couldn't load/, act: showConveyors },
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
    shows: "This Google account hasn't been invited. Sign-in is invite-only during the beta.",
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
  { scenario: "default", name: "default-narrow-desktop", shows: / played$/, width: 1024 },
  { scenario: "stale", name: "stale-narrow-desktop", shows: /Showing last known data from/, width: 1024 },
  // The Health card's tick bar and line (the red zone is below 10 ticks/s).
  { scenario: "slow-tick", shows: "8.2/s" },
  // With FicsitRemoteMonitoring, the online names show under the count (ADR-0029).
  { scenario: "players-some", shows: "Pioneer-Alpha" },
  { scenario: "players-many", shows: "10 of 12 players connected" },
  { scenario: "players-0-of-12", shows: "No players connected (12 slots)" },
  { scenario: "players-7-of-12", shows: "Pioneer-07" },
  { scenario: "players-12-of-12", shows: "12 of 12 players connected" },
  { scenario: "no-game", shows: "No save loaded" },
  // The Overview banner: its text also holds the hidden "!" icon, so no ^ anchor.
  // The Power tile says why (the generic "Power outage" headline under OUTAGE is not drawn, ADR-0064).
  { scenario: "outage", shows: /circuit has a tripped fuse$/ },
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
  // ADR-0062 F.3: a ?state= deep link opens with those toggles pressed and the rows (with their marks) filtered; a keyboard
  // user turns one more on and off again (Enter, then Space), so the screenshot is the link's own state.
  {
    scenario: "factory-states",
    name: "factory-state-filter",
    path: "/app/factory?state=backedUp,paused",
    shows: /^Backed up \d+$/,
    act: async (page) => {
      const filters = page.getByRole("group", { name: "Filter machines" });
      await expect(filters.getByRole("button", { name: /^Backed up \d+$/ })).toHaveAttribute("aria-pressed", "true");
      await expect(filters.getByRole("button", { name: /^Paused \d+$/ })).toHaveAttribute("aria-pressed", "true");
      await expect(filters.getByRole("button", { name: /^All \d+$/ })).toHaveAttribute("aria-pressed", "false");
      await pressButton(page, /^No recipe \d+$/);
      await expect(filters.getByRole("button", { name: /^No recipe \d+$/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/state=backedUp%2Cpaused%2CnoRecipe/);
      await page.keyboard.press("Space");
      await expect(filters.getByRole("button", { name: /^No recipe \d+$/ })).toHaveAttribute("aria-pressed", "false");
      await expect(page).toHaveURL(/state=backedUp%2Cpaused$/);
    },
  },
  // ADR-0062 F.5 per group (F.2): a group of 55 constructors capped at its first 50 with "Show all" under it.
  // ADR-0064: the table starts folded, so the factory and then its group are opened.
  { scenario: "factory-many-machines", path: "/app/factory", shows: "Showing 50 of 55 machines.", act: (page) => openGroup(page, "55× Constructor") },
  // ADR-0064: a group's one row, opened to its machines (the Planner's factories fixture).
  {
    scenario: "factory-grouped",
    name: "factory-grouped-open",
    path: "/app/factory",
    shows: /^Iron Plate factory · 11 machines · 1 backed up$/,
    act: (page) => openGroup(page, "4× Constructor"),
  },
  // ADR-0062 F.2: the table grouped by the Planner's factories and groups, then "Other machines"; the flat fallback.
  { scenario: "factory-grouped", path: "/app/factory", shows: /^Other machines · 1 machine$/ },
  { scenario: "factory-grouped-nested", path: "/app/factory", shows: /^Main base · 5 machines · 1 backed up$/ },
  { scenario: "factory-groups-error", path: "/app/factory", shows: "The Planner's factories could not be read, so the machines are listed in one table." },
  // ADR-0048 (#349), the bottleneck card's full list, opened in place (ADR-0064). The default scenario's belt cap is named
  // in the backend's sentence; no "Capped by" line repeats it.
  { scenario: "default", name: "bottlenecks-belt-cap", path: "/app/factory", shows: /caps Limestone at 60/, act: openBottlenecks },
  { scenario: "bottlenecks-old-frm", path: "/app/factory", shows: /Update FRM to 1.5.4/, act: openBottlenecks },
  { scenario: "bottlenecks-too-large", path: "/app/factory", shows: /connection data is too large/, act: openBottlenecks },
  { scenario: "bottlenecks-not-received", path: "/app/factory", shows: /No belt data has arrived from the game server yet/, act: openBottlenecks },
  // ADR-0062 F.1, the summary above the table, the read failing (the default shows two causes, its third a small gap left
  // out; bottlenecks-empty none).
  { scenario: "bottlenecks-error", path: "/app/factory", shows: /credentials for the game server were rejected/ },
  { scenario: "bottlenecks-empty", path: "/app/factory", shows: /No bottlenecks/ },
  { scenario: "bottlenecks-unknown-kind", path: "/app/factory", shows: /smart splitter upstream filters Limestone/, act: openBottlenecks },
  // ADR-0050 task 5, the Planner page. The fixtures were observed at
  // PLANNER_NOW minus 8 s, so the age reads the same every run.
  { scenario: "default", name: "planner-sites", path: "/app/planner", shows: "Iron Plate site", clock: PLANNER_NOW },
  {
    scenario: "default",
    name: "planner-site-detail",
    path: "/app/planner",
    shows: "All connections",
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronSite(page);
      await page.getByRole("button", { name: "Outline" }).click();
    },
  },
  // ADR-0062 Decision 3: the outline's "Needs attention" with a stalled output (its mark, then its word), and the phone's
  // view of it (the outline is the whole planner below 640 px).
  {
    scenario: "planner-stalled",
    name: "planner-outline-attention",
    path: "/app/planner",
    shows: "Needs attention",
    clock: PLANNER_NOW,
    act: async (page) => {
      await openIronSite(page);
      await page.getByRole("button", { name: "Outline" }).click();
      await expect(page.getByRole("list", { name: "Needs attention" })).toBeVisible();
    },
  },
  // ADR-0050 task 6, the graph. A site opens on the graph at 1440 px and on the outline at 390 px (Decision 4).
  {
    scenario: "default",
    name: "planner-site-default-view",
    path: "/app/planner",
    shows: /^(Zoom in|All connections)$/,
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
  // #728 step 2: a stalled group's card reads "Iron Plate · 0 of 160/min" with a muted "Backed up" line (in marks mode,
  // the default since ADR-0062 build PR 2, the backed-up mark on that row instead), and its side panel "0 of 160 items/min ·
  // backed up".
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
  // ADR-0063 build PR 5, behind `planner.ports` (with its ports and end labels): a selected card dims to its neighbours
  // (state 4), its panel's "Show what … feeds and needs" (state 2), and an opened factory's context (state 5).
  {
    scenario: "planner-group-panel",
    name: "planner-dim-select",
    path: "/app/planner",
    shows: /and its neighbours$/,
    clock: PLANNER_NOW,
    storage: { "planner.ports": "on" },
    act: async (page) => {
      await openIronGraph(page);
      await page.getByRole("button", { name: /^8× Constructor, Iron Plate/ }).focus();
      await page.keyboard.press("Enter");
    },
  },
  {
    scenario: "planner-group-panel",
    name: "planner-dim-path",
    path: "/app/planner",
    shows: /feeds and needs: \d+ of \d+ cards$/,
    clock: PLANNER_NOW,
    storage: { "planner.ports": "on" },
    act: async (page) => {
      await openIronGraph(page);
      await page.getByRole("button", { name: /^8× Constructor, Iron Plate/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: /^Show what .+ feeds and needs$/ }).click();
    },
  },
  {
    scenario: "planner-factories",
    name: "planner-dim-context",
    path: "/app/planner",
    shows: "Fit to view",
    clock: FACTORIES_NOW,
    storage: { "planner.ports": "on" },
    act: openPlateFactoryGraph,
  },
  // #728 cause 11: a card built from conveyor data older than the factory read says so (muted, a clock glyph).
  {
    scenario: "planner-stale-end",
    name: "planner-stale-end-graph",
    path: "/app/planner",
    shows: "Fit to view",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await pressButton(page, "Open factory: Iron Rod factory");
      await page.getByRole("button", { name: "Graph", exact: true }).click();
      await expect(page.getByRole("img", { name: /^Graph of Iron Rod factory/ })).toBeVisible();
    },
  },
  // ADR-0055 PR 7: factories as the first level, an opened factory's outline, and the trees of a recipe in one bubble.
  // The overview is the canvas from 640 px and the outline below (ADR-0055 PR 8, ADR-0062 Decision 3).
  { scenario: "planner-factories", path: "/app/planner", shows: /^(All connections|Zoom in)$/, clock: FACTORIES_NOW },
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
    shows: "All connections",
    clock: FACTORIES_NOW,
    act: openPlateFactoryOutline,
  },
  {
    scenario: "planner-factories-trees",
    name: "planner-factory-trees",
    path: "/app/planner",
    shows: /tree 1 of 2/,
    clock: FACTORIES_NOW,
    act: openPlateFactoryOutline,
  },
  // ADR-0055 PR 10a: designated factories in the text form. The overview opens on the canvas from 640 px, so each asks for the outline.
  {
    scenario: "planner-designations",
    name: "planner-designated",
    path: "/app/planner",
    shows: /1 machine no longer found/,
    clock: FACTORIES_NOW,
    act: (page) => page.getByRole("button", { name: "Outline" }).click(),
  },
  {
    scenario: "planner-designations",
    name: "planner-designate-form",
    path: "/app/planner",
    shows: "Designate",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await openPlateFactoryOutline(page);
      await page.getByRole("button", { name: "Select Smelter", exact: true }).click();
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
      await page.getByRole("button", { name: "Outline" }).click();
      await page.getByRole("button", { name: "Select Constructor", exact: true }).click();
    },
  },
  // ADR-0061 build PR 6: a parent's level (its own machines beside its two factories, under the
  // breadcrumb "All factories / Main base / Smelters"), and the overview with Main base and Smelters blown up in place.
  {
    scenario: "planner-nested",
    name: "planner-nested-level",
    path: "/app/planner",
    shows: "All factories",
    clock: FACTORIES_NOW,
    act: async (page) => {
      // Anchored and without the parent's own-machines card: a string name matches as a substring, so "Smelters" would
      // also match "Smelters (own machines)" (and the canvas card's name goes on past the factory's).
      await pressButton(page, /^Open factory: Main base(?! \(own)/);
      await pressButton(page, /^Open factory: Smelters(?! \(own)/);
      await expect(page.getByRole("navigation", { name: "Factory path" }).locator('[aria-current="page"]')).toHaveText("Smelters");
    },
  },
  {
    scenario: "planner-nested",
    name: "planner-nested-blown-up",
    path: "/app/planner",
    shows: "Fit to view",
    clock: FACTORIES_NOW,
    act: async (page) => {
      await page.getByRole("button", { name: "Graph", exact: true }).click();
      const overview = page.getByRole("img", { name: /^Graph of Factories/ });
      await canvasMeasured(overview);
      await pressButton(page, /^Expand Main base in place into its/);
      await pressButton(page, /^Expand Smelters in place into its/);
      await expect(overview.locator("[data-blow-up-frame]")).toHaveCount(2);
      // Focus may have panned the small 390 px canvas to the last card: fit the view so the screenshot is the same every run.
      await page.getByRole("button", { name: "Fit to view" }).click();
      for (const frame of await overview.locator("[data-blow-up-frame]").all()) await expect(frame).toBeVisible();
    },
  },
  { scenario: "planner-bottlenecks", path: "/app/planner", shows: /1 bottleneck/, clock: PLANNER_NOW },
  { scenario: "planner-empty", path: "/app/planner", shows: /No sites yet/, clock: PLANNER_NOW },
  { scenario: "planner-old-frm", path: "/app/planner", shows: /Update FRM to 1.5.4/, clock: PLANNER_NOW },
  { scenario: "planner-too-large", path: "/app/planner", shows: /connection data is too large/, clock: PLANNER_NOW },
  { scenario: "planner-not-received", path: "/app/planner", shows: /No belt data has arrived from the game server yet/, clock: PLANNER_NOW },
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
  { scenario: "metrics-forbidden", path: "/app/metrics", shows: / played$/ },
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
  { scenario: "alerts", name: "alerts-badge-overview", shows: / played$/ },
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
    shows: /until the mod is enrolled again/,
    clock: AGENT_NOW,
    act: (page) => page.getByRole("button", { name: "Revoke…" }).click(),
  },
  { scenario: "agent-silent-owner", path: "/app/settings", shows: /Hasn't reported yet/, clock: AGENT_NOW },
  // #740 follow-up: the agent's own view of the game, with the same clock (its last read 9 s ago, or 12 m ago).
  { scenario: "agent-game-reachable-owner", path: "/app/settings", shows: "last read 9 s ago", clock: AGENT_NOW },
  { scenario: "agent-game-unreachable-owner", path: "/app/settings", shows: "Not reachable", clock: AGENT_NOW },
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
    act: (page) => page.getByRole("button", { name: "Remove My first world from Satis Manager" }).click(),
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
  { scenario: "agent-enrolled-viewer", path: "/app/settings", shows: "Only a server owner or admin can enrol or revoke the mod.", clock: AGENT_NOW },
  // The command bar (#351), open over the Overview: a native modal dialog, so the CSP guard here
  // also proves it injects no <style> (ADR-0016 item 8).
  {
    scenario: "default",
    name: "command-bar",
    // A command's text: the search box's placeholder isn't text getByText can find.
    shows: "Satis Manager mod",
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

async function showConveyors(page: Page) {
  await page.getByRole("checkbox", { name: "Belts and pipes" }).check();
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

for (const { scenario, shows, path = "/app", name = scenario, act, clock, browser, ready, width, storage } of CASES) {
  test(`state: ${name}`, async ({ page, mockApi }, testInfo) => {
    test.skip(width !== undefined && testInfo.project.name !== "desktop", "one narrow-desktop width is enough");
    if (width !== undefined) await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 900 });
    if (storage) {
      await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value);
      }, Object.entries(storage));
    }
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
    await paintLazyRows(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

// #616, then ADR-0064 Decision 6: the page's age badge sits beside the server picker; its label changes, nothing in the
// header or the Health card moves.
test("the header and the Health card keep their layout as the status ages", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.clock.setFixedTime(LIVE_NOW);
  await page.goto("/app");
  const age = page.locator("[data-page-age]");
  const card = page.getByRole("region", { name: "Health" });
  const badge = age.locator("[data-age-label]");
  await expect(badge).toHaveText("live");
  // Measured once the page's entrance animations end: mid-reveal the card is still sliding by a fraction of a pixel.
  const boxes = async () => {
    await settleAnimations(page);
    return [
      // The server chip: a paragraph, not a button, with one server.
      await page.locator("p", { hasText: "Game server:" }).boundingBox(),
      await age.boundingBox(),
      await page.getByRole("button", { name: "Account" }).boundingBox(),
      await card.locator("[data-statement]").boundingBox(),
      await card.boundingBox(),
    ];
  };
  const before = await boxes();
  await page.clock.setFixedTime(new Date(Date.parse(LIVE_NOW) + 195_000).toISOString());
  await expect(badge).toHaveText("3 min");
  expect(await boxes()).toEqual(before);
});

import { act, screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { POLL_MS } from "./api/queries";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

// The owner's report (2026-10-21): with the game server down from the start, every poll flipped the
// never-answered reads back to pending, so skeletons came back, the banner row collapsed and panels
// re-mounted, and each panel added its own "Game server unreachable." notice.

const UNREACHABLE = "Game server unreachable.";
/** Each wait's ceiling. Generous: a loaded CI runner took 3.5 s for one poll's request (#559's run). */
const WAIT_MS = 10_000;
/** A test runs several polls of up to WAIT_MS each, so it gets more than Vitest's 5 s default. */
const TEST_MS = 60_000;
/** Long enough that the mid-poll check below runs while the requests are still out. */
const ROUND_TRIP_MS = 150;
type Down = "status" | "power" | "powerHistory" | "factory" | "settings";
const DOWN: ReadonlyArray<readonly [Down, string]> = [
  ["status", endpoints.status.route],
  ["power", endpoints.power.route],
  ["powerHistory", endpoints.powerHistory.route],
  ["factory", endpoints.factory.route],
  ["settings", endpoints.settings.get.route],
];

/** Every game-backed read answers 503 upstream_unreachable from the first request; counts each. */
function gameDown() {
  const counts: Record<Down, number> = { status: 0, power: 0, powerHistory: 0, factory: 0, settings: 0 };
  server.use(
    ...DOWN.map(([key, route]) =>
      http.get(route, async () => {
        counts[key] += 1;
        // A real round trip: without one the answer lands before the query's "fetching" state is
        // rendered, and the flip back to pending this file is about never shows.
        await delay(ROUND_TRIP_MS);
        return HttpResponse.json(errorUpstreamUnreachable, { status: 503 });
      }),
    ),
  );
  return counts;
}

/** The shell's banner row; jsdom doesn't apply its `:not(:has(p,[role]))` hiding, so check it by hand. */
function bannerRowShows() {
  const row = document.querySelector('[class*="has(p,[role])"]');
  return row?.querySelector("p, [role]") !== null && row !== null;
}

afterEach(() => vi.useRealTimers());

async function openAt(path: string) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const counts = gameDown();
  window.history.pushState(null, "", path);
  const { client } = renderWithClient(<App />);
  const first = await screen.findByText(UNREACHABLE, {}, { timeout: WAIT_MS });
  await vi.waitFor(() => expect(client.isFetching()).toBe(0), { timeout: WAIT_MS });
  // Settled: no skeleton anywhere from here on.
  await vi.waitFor(() => expect(document.querySelector("[data-skeleton]")).toBeNull(), { timeout: WAIT_MS });
  return { counts, client, first };
}

/** One poll interval: `check` runs while the requests are out (the old flip) and again once they're answered. */
async function poll(
  client: ReturnType<typeof renderWithClient>["client"],
  ms: number,
  counts: Record<Down, number>,
  check: () => void,
) {
  // The interval's refetch is deduplicated into any status fetch already in flight (TanStack returns the
  // running promise), and then no new request is sent. After the first answers a page keeps refetching
  // errored queries as panels mount (the Power page's did, ~170 ms apart), so "settled" can be a gap
  // between two of them. Take the count and advance in the same tick as the check that nothing is in flight.
  await vi.waitFor(() => expect(client.isFetching()).toBe(0), { timeout: WAIT_MS, interval: 5 });
  const before = counts.status;
  act(() => void vi.advanceTimersByTime(ms));
  // vi.waitFor, not RTL's: RTL's re-checks on a setInterval, which is faked here, so it only re-checks
  // on a DOM change, and a request count isn't one.
  await vi.waitFor(() => expect(counts.status).toBeGreaterThan(before), { timeout: WAIT_MS, interval: 5 });
  // Mid-flight: the queries are fetching again, and React has rendered that (setTimeout is real here).
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(client.isFetching()).toBeGreaterThan(0);
  check();
  await vi.waitFor(() => expect(client.isFetching()).toBe(0), { timeout: WAIT_MS });
  // Let React commit what the answers changed.
  await act(async () => {});
  check();
}

/** After each poll: one notice, the same node, the banner row up, no skeleton. */
function expectSteady(first: HTMLElement) {
  const notices = screen.getAllByText(UNREACHABLE);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toBe(first);
  expect(bannerRowShows()).toBe(true);
  expect(document.querySelector("[data-skeleton]")).toBeNull();
}

describe("the game server unreachable from the first request", { timeout: TEST_MS }, () => {
  it("holds the Overview steady over several status polls, with one notice", async () => {
    const { counts, client, first } = await openAt("/app");
    const overview = screen.getByRole("heading", { level: 2 });
    const check = () => {
      expectSteady(first);
      // The Overview's content never re-mounts (no skeleton swap in between).
      expect(screen.getByRole("heading", { level: 2 })).toBe(overview);
    };
    for (let i = 0; i < 4; i++) await poll(client, POLL_MS.status, counts, check);
    // A 30 s jump on top (40 s to 70 s): another factory poll, at 60 s.
    const factoryBefore = counts.factory;
    await poll(client, POLL_MS.factory, counts, check);
    expect(counts.factory).toBeGreaterThan(factoryBefore);
  });

  it("keeps the Power page's chart mounted: the history is read once over three status polls", async () => {
    const { counts, client, first } = await openAt("/app/power");
    // Both power panels are a quiet empty panel, not a second or third notice.
    expect(within(screen.getByRole("region", { name: "Power" })).getByText(/No data while the game server is unreachable/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Power history" })).toBeInTheDocument();
    expect(counts.powerHistory).toBe(1);
    const history = screen.getByRole("region", { name: "Power history" });
    const check = () => {
      expectSteady(first);
      expect(screen.getByRole("region", { name: "Power history" })).toBe(history);
    };
    for (let i = 0; i < 3; i++) await poll(client, POLL_MS.status, counts, check);
    expect(counts.powerHistory).toBe(1);
  });

  it("holds the Factory page steady over status polls and a factory poll", async () => {
    const { counts, client, first } = await openAt("/app/factory");
    const factory = screen.getByRole("region", { name: "Factory" });
    const check = () => {
      expectSteady(first);
      expect(screen.getByRole("region", { name: "Factory" })).toBe(factory);
    };
    const factoryBefore = counts.factory;
    // Three status polls; the third (30 s in) is also the factory's first.
    for (let i = 0; i < 3; i++) await poll(client, POLL_MS.status, counts, check);
    expect(counts.factory).toBeGreaterThan(factoryBefore);
  });
});

describe("errors other than the server-wide unreachable one stay per panel", { timeout: TEST_MS }, () => {
  it("shows power's contract drift next to the banner's unreachable notice", async () => {
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 503 })),
      // Not a power snapshot: the client's schema check fails it as contract drift.
      http.get(endpoints.power.route, () => HttpResponse.json({ unexpected: true })),
    );
    window.history.pushState(null, "", "/app/power");
    renderWithClient(<App />);
    await screen.findByText(UNREACHABLE, {}, { timeout: WAIT_MS });
    expect(await screen.findByText(/The dashboard got a response it doesn't understand/, {}, { timeout: WAIT_MS })).toBeInTheDocument();
    expect(screen.getAllByText(UNREACHABLE)).toHaveLength(1);
  });

  it("keeps the factory's own unreachable notice when the status read still answers", async () => {
    // FRM down while the game's own API answers: the banner has nothing to say, so the panel does.
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusRunning)),
      http.get(endpoints.factory.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 503 })),
    );
    window.history.pushState(null, "", "/app/factory");
    renderWithClient(<App />);
    const notice = await screen.findByText(UNREACHABLE, {}, { timeout: WAIT_MS });
    expect(notice.closest('[class*="has(p,[role])"]')).toBeNull();
    expect(screen.getAllByText(UNREACHABLE)).toHaveLength(1);
  });
});

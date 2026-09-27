import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, useLocation } from "react-router";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type ServerSummary } from "@satisfactory-dash/shared";
import {
  errorUpstreamUnreachable,
  factoryEmpty,
  factoryMixed,
  historyItems7d,
  serversMultiple,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { createQueryClient, queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryView, REVEAL_GRACE_MS } from "./FactoryView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <MemoryRouter><FactoryView /></MemoryRouter>
    </ServerContext>,
  );
}

/** Switches the ServerContext value without remounting FactoryView, like the shell's server picker. */
function SwitchableView({ initial, other }: { initial: ServerSummary; other: ServerSummary }) {
  const [selected, setSelected] = useState(initial);
  return (
    <ServerContext value={selected}>
      <button type="button" onClick={() => setSelected(other)}>
        Switch server
      </button>
      <MemoryRouter><FactoryView /></MemoryRouter>
    </ServerContext>
  );
}

/** Cycles through servers on each click (unlike SwitchableView's one-way switch), for tests
 *  that need to switch back and forth or through more than two servers. */
function CyclingView({ servers }: { servers: ServerSummary[] }) {
  const [index, setIndex] = useState(0);
  return (
    <ServerContext value={servers[index]}>
      <button type="button" onClick={() => setIndex((i) => (i + 1) % servers.length)}>
        Switch server
      </button>
      <MemoryRouter><FactoryView /></MemoryRouter>
    </ServerContext>
  );
}

/** Holds the 7d history ("Since yesterday") until the returned function is called. */
function holdSinceYesterday(serverId?: string): () => void {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  server.use(
    http.get(endpoints.history.items.route, async ({ params, request }) => {
      const range = new URL(request.url).searchParams.get("range");
      if (range === "7d" && (!serverId || params.serverId === serverId)) await held;
      return HttpResponse.json(historyItems7d);
    }),
  );
  return release;
}

/** Generous slack over the grace for a loaded CI machine; still far below a slow history read. */
const WITHIN_GRACE = { timeout: REVEAL_GRACE_MS + 700 };

describe("FactoryView", () => {
  it("polls factory every 30 s (ADR-0005)", () => {
    expect(queries.factory("default").refetchInterval).toBe(30_000);
  });

  it("shows a status while the factory loads, then the panel", async () => {
    server.use(
      http.get(endpoints.factory.route, async () => {
        await delay(50);
        return HttpResponse.json(factoryMixed);
      }),
    );
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
  });

  // ADR-0032: one reveal when "Since yesterday" is quick, and the table never waits on it for long.
  it("reveals the table and 'Since yesterday' together when both land within the grace", async () => {
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    // Both were in by the reveal: no loading step left inside the reserved box.
    expect(screen.getByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
    expect(screen.queryByText(/Loading what changed since yesterday/)).not.toBeInTheDocument();
  });

  it("shows the factory table within the grace when the 'since yesterday' history takes 3 s", async () => {
    server.use(
      http.get(endpoints.history.items.route, async ({ request }) => {
        if (new URL(request.url).searchParams.get("range") === "7d") await delay(3_000);
        return HttpResponse.json(historyItems7d);
      }),
    );
    const start = performance.now();
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" }, WITHIN_GRACE)).toBeInTheDocument();
    expect(performance.now() - start).toBeLessThan(2_000);
    // "Since yesterday" waits in its own box meanwhile.
    expect(screen.getByText("Loading what changed since yesterday…")).toBeInTheDocument();
  });

  // A tab switch with the factory already cached (the Overview reads it): nothing to wait for, since
  // the box is reserved. A grace here would only turn a still page into a late reveal (ADR-0032).
  it("shows the table at once, without the grace, when the factory is already cached", async () => {
    holdSinceYesterday();
    function OpenLater() {
      const [open, setOpen] = useState(false);
      return open ? (
        <ServerContext value={serversSingle.servers[0]}>
          <MemoryRouter><FactoryView /></MemoryRouter>
        </ServerContext>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Open Factory
        </button>
      );
    }
    const { client } = renderWithClient(<OpenLater />);
    await client.prefetchQuery(queries.factory(serversSingle.servers[0].id));

    fireEvent.click(screen.getByRole("button", { name: "Open Factory" }));
    expect(screen.getByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByText("Loading what changed since yesterday…")).toBeInTheDocument();
  });

  it("fills 'Since yesterday' in its box once its late read lands, with the table already shown", async () => {
    const release = holdSinceYesterday();
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" }, WITHIN_GRACE)).toBeInTheDocument();
    expect(screen.getByText("Loading what changed since yesterday…")).toBeInTheDocument();

    release();
    expect(await screen.findByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Factory" })).toBeInTheDocument();
  });

  it("still reveals the page when a 'since yesterday' read fails, and doesn't hide it again", async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.history.transitions.route, () => {
        calls += 1;
        return HttpResponse.json(errorUpstreamUnreachable, { status: 502 });
      }),
    );
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    // "Since yesterday" retries the failed read once when it mounts; the page stays shown meanwhile
    // instead of hiding and asking again in a loop.
    await delay(200);
    expect(screen.getByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(calls).toBeLessThanOrEqual(2);
    // The comparison still shows without the transitions line.
    expect(screen.getByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
    expect(screen.queryByText(/Machines changed state/)).not.toBeInTheDocument();
  });

  it("shows the table and the error in the 'Since yesterday' box when the 7d history fails", async () => {
    server.use(
      http.get(endpoints.history.items.route, ({ request }) =>
        new URL(request.url).searchParams.get("range") === "7d"
          ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 })
          : HttpResponse.json(historyItems7d),
      ),
    );
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" }, WITHIN_GRACE)).toBeInTheDocument();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("Game server unreachable."))).toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("gives a newly-selected server its own grace, without leaking the old server's reveal", async () => {
    server.use(
      http.get(endpoints.factory.route, ({ params }) =>
        HttpResponse.json(params.serverId === "creative-test" ? factoryEmpty : factoryMixed),
      ),
    );
    const release = holdSinceYesterday("creative-test");
    renderWithClient(
      <SwitchableView initial={serversMultiple.servers[0]} other={serversMultiple.servers[1]} />,
    );
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByText(/backed up/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    // The previous server's page must not stay up while the new one loads.
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");
    expect(screen.queryByRole("region", { name: "Factory" })).not.toBeInTheDocument();

    // The new server's 7d read is still held: its table shows after the grace anyway.
    expect(await screen.findByText("No machines yet.", {}, WITHIN_GRACE)).toBeInTheDocument();
    expect(screen.getByText(/Loading what changed since yesterday/)).toBeInTheDocument();

    release();
    expect(await screen.findByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
  });

  it("shows the error with its request ID when the factory can't be read", async () => {
    server.use(
      http.get(endpoints.factory.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
  });

  it("shows the factory error within the grace even while 'Since yesterday' is still pending", async () => {
    server.use(
      http.get(endpoints.factory.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    const release = holdSinceYesterday();
    renderView();
    const alert = await screen.findByRole("alert", {}, WITHIN_GRACE);
    expect(alert).toHaveTextContent("Game server unreachable.");
    release();
  });

  it("waits on the factory itself past the grace, then reveals with 'Since yesterday' already in place", async () => {
    server.use(
      http.get(endpoints.factory.route, async () => {
        await delay(REVEAL_GRACE_MS + 200);
        return HttpResponse.json(factoryMixed);
      }),
    );
    renderView();
    // Still loading well past the grace: the factory's own read is what's pacing this, not history.
    await act(() => delay(REVEAL_GRACE_MS + 50));
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");

    expect(await screen.findByRole("region", { name: "Factory" }, WITHIN_GRACE)).toBeInTheDocument();
    // "Since yesterday" was ready well before the factory landed, so it shows immediately too.
    expect(screen.queryByText(/Loading what changed since yesterday/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
  });

  it("shows an already-revealed server's content again immediately when switching back to it", async () => {
    server.use(
      http.get(endpoints.factory.route, ({ params }) =>
        HttpResponse.json(params.serverId === "creative-test" ? factoryEmpty : factoryMixed),
      ),
    );
    renderWithClient(<CyclingView servers={[serversMultiple.servers[0], serversMultiple.servers[1]]} />);
    expect(await screen.findByText(/backed up/)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Switch server" });
    fireEvent.click(button);
    expect(await screen.findByText("No machines yet.")).toBeInTheDocument();

    fireEvent.click(button);
    // Back on the already-revealed first server: its cached content shows at once, no reload flash.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(/backed up/)).toBeInTheDocument();
  });

  it("settles on the last of several rapid server switches without ever mixing servers' content", async () => {
    server.use(
      http.get(endpoints.factory.route, ({ params }) =>
        HttpResponse.json(params.serverId === "creative-test" ? factoryEmpty : factoryMixed),
      ),
    );
    renderWithClient(<CyclingView servers={serversMultiple.servers} />);
    expect(await screen.findByText(/backed up/)).toBeInTheDocument();

    // default -> creative-test -> friends-2 -> default, fired faster than any one settles.
    const button = screen.getByRole("button", { name: "Switch server" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // Whatever lands belongs to "default" alone: creative-test's marker never sticks around.
    expect(await screen.findByText(/backed up/)).toBeInTheDocument();
    expect(screen.queryByText("No machines yet.")).not.toBeInTheDocument();
  });

  it("clears its grace timer on unmount, so it never fires a late state update", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderView();
    unmount();
    await delay(REVEAL_GRACE_MS + 100);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("still reveals correctly once under StrictMode's double-invoked effects", async () => {
    const client = createQueryClient();
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ServerContext value={serversSingle.servers[0]}>
            <MemoryRouter><FactoryView /></MemoryRouter>
          </ServerContext>
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Since yesterday/ })).toBeInTheDocument();
  });
});

// Whether the data is late is the backend's call (`stale`) or a failed refresh, never this PC's
// clock (the architect's #249 note). FactoryView must pass refetchFailed through like PowerView.
describe("FactoryView's data-age warning", () => {
  afterEach(() => vi.useRealTimers());

  it("doesn't call fresh data late when this PC's clock is a day ahead", async () => {
    vi.setSystemTime(Date.parse(factoryMixed.observedAt) + 86_400_000);
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
    renderView();
    expect(await screen.findByText(/^Updated 1 d /)).toBeInTheDocument();
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();
  });

  it("calls the data late when the backend says it's stale", async () => {
    const stale = { ...factoryMixed, stale: true };
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(stale)));
    renderView();
    expect(await screen.findByText(/newer data is overdue/)).toBeInTheDocument();
  });

  it("clears the warning once a refresh recovers after a failed one", async () => {
    let fail = false;
    server.use(
      http.get(endpoints.factory.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 503 }) : HttpResponse.json(factoryMixed),
      ),
    );
    const { client } = renderView();
    await screen.findByRole("region", { name: "Factory" });
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();

    fail = true;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument());

    fail = false;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument());
  });
});

/** Shows the router's current URL, so a test can see what the page wrote there. */
function Where() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="URL">{`${pathname}${search}${hash}`}</output>;
}

function renderAt(url: string) {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <MemoryRouter initialEntries={[url]}>
        <FactoryView />
        <Where />
      </MemoryRouter>
    </ServerContext>,
  );
}

// #351's deep links: the machine search and the history's item live in the URL.
describe("FactoryView deep links", () => {
  it("opens with the machine search from ?q= filled in and applied", async () => {
    renderAt(`/app/factory?q=${encodeURIComponent(factoryMixed.data.buildings[0].name)}`);
    expect(await screen.findByRole("searchbox", { name: "Search machines" })).toHaveValue(factoryMixed.data.buildings[0].name);
  });

  it("writes the search back to the URL as typed, keeping other parameters, and drops it when cleared", async () => {
    renderAt("/app/factory?scenario=default");
    const box = await screen.findByRole("searchbox", { name: "Search machines" });
    fireEvent.change(box, { target: { value: "iron " } });
    expect(box).toHaveValue("iron ");
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("/app/factory?scenario=default&q=iron+");
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent(/^\/app\/factory\?scenario=default$/);
  });

  it("opens production history on the item from ?item=, and writes a new pick back", async () => {
    renderAt("/app/factory?item=Desc_Wire_C#history");
    const picker = await screen.findByRole("combobox", { name: "Item" });
    expect(picker).toHaveValue("Desc_Wire_C");
    fireEvent.change(picker, { target: { value: "Desc_IronPlate_C" } });
    expect(screen.getByRole("status", { name: "URL" })).toHaveTextContent("item=Desc_IronPlate_C");
  });

  it("ignores an ?item= that isn't a class name, and shows the first item", async () => {
    renderAt("/app/factory?item=%3Cscript%3E");
    const picker = await screen.findByRole("combobox", { name: "Item" });
    expect(picker).toHaveValue("Desc_IronPlate_C");
  });
});

// A real BrowserRouter, not MemoryRouter: useHashTarget reads window.location/history directly
// (by design), and react-router only touches those through a real (or Browser-backed) history.
// This is the one place that can catch the two interacting: typing in ?q= replaces the URL, which
// must not re-trigger #history's jump and steal focus back from the search box.
describe("FactoryView deep links + #history jump, on a real history (#351)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps #history in the URL when the search is edited (react-router's setSearchParams drops the fragment)", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/app/factory?item=Desc_Wire_C#history");
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <BrowserRouter><FactoryView /></BrowserRouter>
      </ServerContext>,
    );
    const box = await screen.findByRole("searchbox", { name: "Search machines" });
    fireEvent.change(box, { target: { value: "iron" } });
    expect(window.location.hash).toBe("#history");
    expect(window.location.search).toContain("q=iron");
  });

  it("typing in the machine search doesn't steal focus back from the box, with #history open", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/app/factory?item=Desc_Wire_C#history");
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <BrowserRouter><FactoryView /></BrowserRouter>
      </ServerContext>,
    );
    // The initial deep link jumps to #history, same as the MemoryRouter tests above prove it applies.
    await waitFor(() => expect(document.getElementById("history")).toHaveFocus());

    const box = await screen.findByRole("searchbox", { name: "Search machines" });
    box.focus();
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "iron" } });
    fireEvent.change(box, { target: { value: "iron p" } });
    expect(box).toHaveFocus();
  });
});

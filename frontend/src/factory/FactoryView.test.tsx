import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerSummary } from "@satisfactory-dash/shared";
import {
  errorUpstreamUnreachable,
  factoryEmpty,
  factoryMixed,
  historyItems7d,
  historyTransitions24h,
  serversMultiple,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryView } from "./FactoryView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <FactoryView />
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
      <FactoryView />
    </ServerContext>
  );
}

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

  // ADR-0032's tab-switch budget: "Since yesterday" sits above the table, so the table waits for it
  // rather than being pushed down when it lands.
  it("reveals the page once, after the factory and both 'since yesterday' reads land", async () => {
    let release = () => {};
    const transitionsHeld = new Promise<void>((r) => (release = r));
    server.use(
      http.get(endpoints.history.transitions.route, async () => {
        await transitionsHeld;
        return HttpResponse.json(historyTransitions24h);
      }),
    );
    renderView();
    // Give the factory and the 7d history time to land; the transitions are still held.
    await delay(100);
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");
    expect(screen.queryByRole("region", { name: "Factory" })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByText(/Machines changed state/)).toBeInTheDocument();
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
  });

  it("waits for a newly-selected server's own reads, without leaking the old server's reveal", async () => {
    let releaseItems = () => {};
    const itemsHeld = new Promise<void>((r) => (releaseItems = r));
    server.use(
      http.get(endpoints.factory.route, ({ params }) =>
        HttpResponse.json(params.serverId === "creative-test" ? factoryEmpty : factoryMixed),
      ),
      http.get(endpoints.history.items.route, async ({ params, request }) => {
        const range = new URL(request.url).searchParams.get("range");
        if (params.serverId === "creative-test" && range === "7d") await itemsHeld;
        return HttpResponse.json(historyItems7d);
      }),
    );
    renderWithClient(
      <SwitchableView initial={serversMultiple.servers[0]} other={serversMultiple.servers[1]} />,
    );
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByText(/backed up/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    // The new server's "since yesterday" 7d read is still held: the page must go back to
    // loading rather than keep showing the previous server's already-revealed content.
    expect(screen.getByRole("status")).toHaveTextContent("Loading factory");
    expect(screen.queryByRole("region", { name: "Factory" })).not.toBeInTheDocument();

    releaseItems();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByText("No machines yet.")).toBeInTheDocument();
  });

  it("reveals the page and lets 'Since yesterday' show its own error when the 7d history fails", async () => {
    server.use(
      http.get(endpoints.history.items.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderView();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("Game server unreachable."))).toBe(true);
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
});

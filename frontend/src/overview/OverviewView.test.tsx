import { act, screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorServiceUnavailable,
  factoryEmpty,
  factoryMixed,
  powerOk,
  serversSingle,
  statusNoGame,
  statusSlow,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { OverviewView } from "./OverviewView";

// The Health card's tick comes only from the status query (OverviewView -> HealthCard). These
// pin that wiring end to end, through the real query cache, since OverviewPanel.test.tsx only
// covers the presentational layer and dismissal.test.tsx never asserts on the tick.

function renderOverview() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <OverviewView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const healthCard = () => screen.getByRole("region", { name: "Health" });

describe("OverviewView: the Health card's tick", () => {
  it("shows the status query's tick rate and the backend's own healthy verdict", async () => {
    renderOverview();
    expect(await screen.findByText("21.4 ticks/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Healthy");
  });

  it("shows the slow verdict and rate the backend classified", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)));
    renderOverview();
    expect(await screen.findByText("8.2 ticks/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Slow");
  });

  it("keeps a slow tick out of the Server row, but still counts it in the overall health", async () => {
    // Everything else is healthy here (no machines backed up), so only the tick can warn.
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryEmpty)),
    );
    renderOverview();
    expect(await screen.findByText("8.2 ticks/s")).toBeInTheDocument();
    expect(await within(healthCard()).findByText("Degraded")).toBeInTheDocument();
    const rows = screen.getByRole("list", { name: "Sections" });
    expect(rows).not.toHaveTextContent(/tick/i);
    expect(within(rows).getAllByText("Operational")).toHaveLength(3);
  });

  it("counts a slow tick as a warning as soon as the status query has data, even while Power and Factory are still loading", async () => {
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)),
      http.get(endpoints.power.route, async () => {
        await delay("infinite");
        return HttpResponse.json(powerOk);
      }),
      http.get(endpoints.factory.route, async () => {
        await delay("infinite");
        return HttpResponse.json(factoryMixed);
      }),
    );
    renderOverview();
    expect(await within(healthCard()).findByText("Degraded")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Server tick is slow");
    const rows = screen.getByRole("list", { name: "Sections" });
    expect(within(rows).getAllByText("Checking…")).toHaveLength(2);
  });

  it("says no game is running instead of a tick when isGameRunning is false", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusNoGame)));
    renderOverview();
    expect(await screen.findByText("Server tick: no game running.")).toBeInTheDocument();
    expect(screen.queryByText(/ticks\/s/)).not.toBeInTheDocument();
  });

  it("shows no tick while the status query is still loading", async () => {
    server.use(
      http.get(endpoints.status.route, async () => {
        await delay("infinite");
        return HttpResponse.json(statusSlow);
      }),
    );
    renderOverview();
    await screen.findByRole("region", { name: "Health" });
    expect(screen.queryByText(/ticks\/s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Server tick/)).not.toBeInTheDocument();
  });

  it("keeps showing the last tick when a background refetch fails (data wins over error)", async () => {
    const { client } = renderOverview();
    expect(await screen.findByText("21.4 ticks/s")).toBeInTheDocument();

    server.use(http.get(endpoints.status.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    await act(() => client.refetchQueries({ type: "active" }));

    // The stale data (and its tick) stays on screen; the failed refetch doesn't blank it.
    expect(screen.getByText("21.4 ticks/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Healthy");
  });
});

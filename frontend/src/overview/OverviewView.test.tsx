import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorServiceUnavailable,
  factoryEmpty,
  factoryMixed,
  powerEmpty,
  powerOk,
  serversSingle,
  statusNoGame,
  statusRunning,
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
    expect(await screen.findByText("21.4/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Healthy");
  });

  it("shows the slow verdict and rate the backend classified", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)));
    renderOverview();
    expect(await screen.findByText("8.2/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Slow");
  });

  it("keeps a slow tick out of the Server row, but still counts it in the overall health", async () => {
    // Everything else is healthy here (no machines backed up), so only the tick can warn.
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryEmpty)),
    );
    renderOverview();
    expect(await screen.findByText("8.2/s")).toBeInTheDocument();
    expect(await within(healthCard()).findByText("Degraded")).toBeInTheDocument();
    const rows = screen.getByRole("list", { name: "Sections" });
    expect(rows).not.toHaveTextContent(/tick/i);
    // #442: healthy rows say no status word at all; the Health card says it once.
    expect(rows).not.toHaveTextContent("Operational");
    expect(rows.querySelectorAll("[data-word]")).toHaveLength(0);
  });

  it("counts a slow tick as a warning once the status query has data", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)));
    renderOverview();
    await screen.findByRole("region", { name: "Health" });
    expect(healthCard().querySelector("[data-statement]")).toHaveTextContent("Degraded");
    expect(healthCard()).toHaveTextContent("Server tick is slow");
  });

  it("says no game is running instead of a tick when isGameRunning is false", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusNoGame)));
    renderOverview();
    expect(await screen.findByText("Tick: no game running.")).toBeInTheDocument();
    expect(screen.queryByText(/ticks\/s/)).not.toBeInTheDocument();
  });

  // #494: the cards come in together, so no card (and no tick) shows while a read is still loading.
  it("holds one skeleton, with no card and no tick, while a read is still loading", async () => {
    server.use(
      http.get(endpoints.status.route, async () => {
        await delay("infinite");
        return HttpResponse.json(statusSlow);
      }),
    );
    renderOverview();
    expect(screen.getByText("Loading the overview…")).toBeInTheDocument();
    await delay(300);
    expect(screen.queryByRole("region", { name: "Health" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ticks\/s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tick/)).not.toBeInTheDocument();
  });

  it("holds the skeleton until the slowest of the three reads has answered, then shows every card", async () => {
    server.use(
      http.get(endpoints.factory.route, async () => {
        await delay(400);
        return HttpResponse.json(factoryMixed);
      }),
    );
    renderOverview();
    await delay(250);
    expect(screen.queryByRole("region", { name: "Health" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Power" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Health" }, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Power" })).toBeInTheDocument();
  });

  it("shows how old the status is in the Health header", async () => {
    renderOverview();
    expect(await screen.findByText("21.4/s")).toBeInTheDocument();
    expect(healthCard().querySelector("[data-age] time")).toHaveAttribute("dateTime", statusRunning.observedAt);
  });

  it("keeps showing the last tick when a background refetch fails (data wins over error)", async () => {
    const { client } = renderOverview();
    expect(await screen.findByText("21.4/s")).toBeInTheDocument();

    server.use(http.get(endpoints.status.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    await act(() => client.refetchQueries({ type: "active" }));

    // The stale data (and its tick) stays on screen; the failed refetch doesn't blank it.
    expect(screen.getByText("21.4/s")).toBeInTheDocument();
    expect(healthCard()).toHaveTextContent("Healthy");
  });
});

const sectionTiles = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem");
const powerCard = () => screen.getByRole("region", { name: "Power" });

describe("OverviewView: station tiles and the Power card (#442)", () => {
  it("shows Server, Power and Factory as tiles inside the Health card", async () => {
    renderOverview();
    await screen.findByText("21.4/s");
    expect(within(healthCard()).getByRole("list", { name: "Sections" })).toBeInTheDocument();
    expect(sectionTiles().map((t) => t.querySelector("svg[data-station]")?.getAttribute("data-station"))).toEqual(["server", "power", "factory"]);
  });

  it("links the Server tile to the Servers page only for an operator who can manage servers", async () => {
    renderOverview();
    await screen.findByText("21.4/s");
    expect(within(sectionTiles()[0]).queryByRole("link")).toBeNull();
    expect(within(sectionTiles()[1]).getByRole("link")).toHaveAttribute("href", "/app/power");
  });

  it("links the Server tile once the server list says the operator can manage servers", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json({ ...serversSingle, canManageServers: true })));
    renderOverview();
    await waitFor(() => expect(within(sectionTiles()[0]).getByRole("link")).toHaveAttribute("href", "/app/servers"));
  });

  it("sums every circuit into the Power card: consumption of capacity, and a flowing strip", async () => {
    const totals = { consumptionMW: 4396, capacityMW: 6150 };
    server.use(
      http.get(endpoints.power.route, () =>
        HttpResponse.json({
          ...powerOk,
          data: {
            ...powerOk.data,
            circuits: [
              { ...powerOk.data.circuits[0], consumptionMW: 4000, capacityMW: 6000 },
              { ...powerOk.data.circuits[0], circuitGroupId: 1, consumptionMW: 396, capacityMW: 150 },
            ],
          },
        }),
      ),
    );
    renderOverview();
    await waitFor(() => expect(powerCard()).toHaveTextContent("4,396 MW of 6,150 MW"));
    expect(powerCard().querySelector("svg[data-flowing]")).toHaveAttribute("data-flowing", "true");
    expect(Number(powerCard().querySelector("svg[data-share]")!.getAttribute("data-share"))).toBeCloseTo(totals.consumptionMW / totals.capacityMW);
  });

  it("says when the grid has no circuits, and when the power query fails", async () => {
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerEmpty)));
    const { unmount } = renderOverview();
    // The cards come in together (#494), so the Power card isn't there until all three reads answer.
    await screen.findByRole("region", { name: "Power" });
    expect(await within(powerCard()).findByText("No power circuits yet.")).toBeInTheDocument();
    unmount();
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    renderOverview();
    await screen.findByRole("region", { name: "Power" });
    expect(await within(powerCard()).findByText("Couldn't load the power grid.")).toBeInTheDocument();
  });
});

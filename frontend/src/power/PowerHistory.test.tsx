import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import uPlot from "uplot";
import { endpoints, type PowerHistoryResponse } from "@satisfactory-dash/shared";
import {
  errorUpstreamUnreachable,
  powerEmpty,
  powerHistoryEmpty,
  powerHistoryFuseTrip,
  powerHistoryNormal,
  powerHistoryPaused,
  powerOk,
  serversSingle,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerHistoryView } from "./PowerHistoryView";

/** The vitest-setup stub for uPlot (jsdom has no canvas): what each chart was given. */
const plots = () => (uPlot as unknown as { instances: { data: unknown[][]; destroyed: boolean }[] }).instances;

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <PowerHistoryView />
    </ServerContext>,
  );
}

/** The summary's value for a label ("Production" is also a table header). */
const summaryValue = (circuit: HTMLElement, label: string) =>
  within(circuit).getByText(label, { selector: "dt" }).nextElementSibling;

const history = (body: PowerHistoryResponse) => server.use(http.get(endpoints.powerHistory.route, () => HttpResponse.json(body)));

describe("PowerHistoryView", () => {
  it("shows each circuit's now/min/max, a chart hidden from screen readers, and a readings table", async () => {
    renderView();
    const circuit = await screen.findByRole("article", { name: "Circuit 0 history" });
    const points = powerHistoryNormal.data.series[0].points;
    const productions = points.map((p) => p.productionMW);
    expect(summaryValue(circuit, "Production")).toHaveTextContent(
      `min ${Math.min(...productions).toLocaleString("en-US", { minimumFractionDigits: 1 })} MW`,
    );
    expect(circuit.querySelector(".power-chart")).toHaveAttribute("aria-hidden", "true");
    expect(within(circuit).getAllByRole("row")).toHaveLength(points.length + 1);
    const plot = plots().at(-1)!;
    expect(plot.data[0]).toHaveLength(points.length);
  });

  it("lists the paused stretches the chart shades", async () => {
    history(powerHistoryPaused);
    renderView();
    expect(await screen.findByText(/Paused \(shaded\):/)).toBeInTheDocument();
  });

  it("draws one chart per circuit, including a tripped one", async () => {
    history(powerHistoryFuseTrip);
    renderView();
    const tripped = await screen.findByRole("article", { name: "Circuit 1 history" });
    expect(within(tripped).getAllByText("Tripped").length).toBeGreaterThan(0);
    // The drop to 0 MW gets a caption saying why, like the paused stretches do.
    expect(within(tripped).getByText(/^Fuse tripped at .*, still tripped\.$/)).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Circuit 0 history" })).queryByText(/Fuse tripped/)).toBeNull();
    expect(screen.getByRole("article", { name: "Circuit 0 history" })).toBeInTheDocument();
  });

  it("says it's collecting when the first poll is the only reading", async () => {
    history(powerHistoryEmpty);
    renderView();
    expect(await screen.findByText("Collecting readings. The chart starts after the next poll.")).toBeInTheDocument();
  });

  it("says there are no readings when there are no circuits at all", async () => {
    history(powerHistoryEmpty);
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerEmpty)));
    renderView();
    expect(await screen.findByText("No readings yet. The chart fills in as the server is polled.")).toBeInTheDocument();
  });

  it("appends a newer regular power poll without refetching the history", async () => {
    let historyReads = 0;
    server.use(
      http.get(endpoints.powerHistory.route, () => {
        historyReads++;
        return HttpResponse.json(powerHistoryNormal);
      }),
    );
    const { client } = renderView();
    const circuit = await screen.findByRole("article", { name: "Circuit 0 history" });

    const last = powerHistoryNormal.data.series[0].points.at(-1)!;
    server.use(
      http.get(endpoints.power.route, () =>
        HttpResponse.json({
          ...powerOk,
          observedAt: new Date(last.t + 10_000).toISOString(),
          data: { ...powerOk.data, circuits: [{ ...powerOk.data.circuits[0], productionMW: 1234.5 }] },
        }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: ["servers", "default", "power"], exact: true }));

    await waitFor(() => expect(summaryValue(circuit, "Production")).toHaveTextContent(/^1,234\.5 MW/));
    expect(plots().at(-1)!.data[1].at(-1)).toBe(1234.5);
    expect(historyReads).toBe(1);
  });

  it("reloads the history when the loaded save changes, so a series never spans a reload", async () => {
    let historyReads = 0;
    server.use(
      http.get(endpoints.powerHistory.route, () => {
        historyReads++;
        return HttpResponse.json(historyReads === 1 ? powerHistoryNormal : powerHistoryEmpty);
      }),
    );
    const { client } = renderView();
    await screen.findByRole("article", { name: "Circuit 0 history" });
    expect(historyReads).toBe(1);

    server.use(
      http.get(endpoints.status.route, () =>
        HttpResponse.json({ ...statusRunning, data: { ...statusRunning.data, sessionName: "New save" } }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: ["servers", "default", "status"], exact: true }));
    await waitFor(() => expect(historyReads).toBe(2));
  });

  it("says when the history is behind", async () => {
    history({ ...powerHistoryNormal, stale: true });
    renderView();
    expect(await screen.findByText("Power history is behind: showing the last readings the server kept.")).toBeInTheDocument();
  });

  it("shows the error when the history can't load", async () => {
    server.use(
      http.get(endpoints.powerHistory.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderView();
    expect(await screen.findByText("Game server unreachable.")).toBeInTheDocument();
  });

  it("destroys the chart when the view goes away", async () => {
    const { unmount } = renderView();
    await screen.findByRole("article", { name: "Circuit 0 history" });
    const plot = plots().at(-1)!;
    unmount();
    expect(plot.destroyed).toBe(true);
  });
});

// Fresh-eyes (test-hunter) pass on PowerHistoryView: what the client-side readings may and
// may not be folded into.
import { act, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type PowerResponse } from "@satisfactory-dash/shared";
import { powerHistoryEmpty, powerHistoryNormal, powerOk, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerHistoryView } from "./PowerHistoryView";

const serverA = serversSingle.servers[0];
const serverB = { id: "other", displayName: "Other server" };
const lastT = powerHistoryNormal.data.series[0].points.at(-1)!.t;

const readingAt = (serverId: string, t: number, productionMW: number): PowerResponse => ({
  ...powerOk,
  serverId,
  observedAt: new Date(t).toISOString(),
  data: { ...powerOk.data, circuits: [{ ...powerOk.data.circuits[0], productionMW }] },
});

const summaryValue = (circuit: HTMLElement, label: string) =>
  within(circuit).getByText(label, { selector: "dt" }).nextElementSibling;

describe("PowerHistoryView, readings it must not fold in", () => {
  // ServerGate keeps its children mounted when `current` changes without passing through the
  // picker (e.g. the single-server auto-select after rediscovery returns a different server).
  it("never folds server A's polls into server B's history", async () => {
    server.use(
      http.get(endpoints.powerHistory.route, ({ params }) =>
        HttpResponse.json({ ...powerHistoryNormal, serverId: String(params.serverId) }),
      ),
      http.get(endpoints.power.route, ({ params }) =>
        params.serverId === serverA.id
          ? HttpResponse.json(readingAt(serverA.id, lastT + 10_000, 1234.5))
          : HttpResponse.json(readingAt(serverB.id, lastT, 1.5)),
      ),
    );
    const { client, rerender } = renderWithClient(
      <ServerContext value={serverA}>
        <PowerHistoryView />
      </ServerContext>,
    );
    const circuitA = await screen.findByRole("article", { name: "Circuit 0 history" });
    await waitFor(() => expect(summaryValue(circuitA, "Production")).toHaveTextContent(/^1,234\.5 MW/));

    rerender(
      <QueryClientProvider client={client}>
        <ServerContext value={serverB}>
          <PowerHistoryView />
        </ServerContext>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(client.getQueryData(["servers", serverB.id, "power"])).toBeDefined());
    const circuitB = await screen.findByRole("article", { name: "Circuit 0 history" });
    expect(summaryValue(circuitB, "Production")).not.toHaveTextContent(/1,234\.5 MW/);
  });

  // The backend clears the history when the game session changes (ADR-0022). Polls seen
  // before a refetch that comes back reset must not reappear on top of it.
  it("drops polls from before a history refetch that came back reset", async () => {
    server.use(
      http.get(endpoints.powerHistory.route, () => HttpResponse.json(powerHistoryNormal)),
      http.get(endpoints.power.route, () => HttpResponse.json(readingAt(serverA.id, lastT + 10_000, 1234.5))),
    );
    const { client } = renderWithClient(
      <ServerContext value={serverA}>
        <PowerHistoryView />
      </ServerContext>,
    );
    const circuit = await screen.findByRole("article", { name: "Circuit 0 history" });
    await waitFor(() => expect(summaryValue(circuit, "Production")).toHaveTextContent(/^1,234\.5 MW/));

    server.use(
      http.get(endpoints.powerHistory.route, () =>
        HttpResponse.json({ ...powerHistoryEmpty, observedAt: new Date(lastT + 20_000).toISOString() }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: ["servers", serverA.id, "power", "history"] }));

    expect(await screen.findByText("No readings yet. The chart fills in as the server is polled.")).toBeInTheDocument();
    expect(screen.queryByText(/1,234\.5 MW/)).not.toBeInTheDocument();
  });

  it("does not re-add a poll the refetched history already covers", async () => {
    server.use(
      http.get(endpoints.powerHistory.route, () => HttpResponse.json(powerHistoryNormal)),
      http.get(endpoints.power.route, () => HttpResponse.json(readingAt(serverA.id, lastT + 10_000, 1234.5))),
    );
    const { client } = renderWithClient(
      <ServerContext value={serverA}>
        <PowerHistoryView />
      </ServerContext>,
    );
    const circuit = await screen.findByRole("article", { name: "Circuit 0 history" });
    await waitFor(() => expect(summaryValue(circuit, "Production")).toHaveTextContent(/^1,234\.5 MW/));

    // The refetch includes a sample after the poll (the server kept sampling).
    const later = { ...powerHistoryNormal.data.series[0].points.at(-1)!, t: lastT + 15_000, productionMW: 999 };
    server.use(
      http.get(endpoints.powerHistory.route, () =>
        HttpResponse.json({
          ...powerHistoryNormal,
          data: {
            ...powerHistoryNormal.data,
            series: [{ circuitGroupId: 0, points: [...powerHistoryNormal.data.series[0].points.slice(3), later] }],
          },
        }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: ["servers", serverA.id, "power", "history"] }));
    await waitFor(() => expect(summaryValue(circuit, "Production")).toHaveTextContent(/^999 MW/));
    expect(within(circuit).getAllByRole("row")).toHaveLength(58 + 1);
  });
});

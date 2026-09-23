import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorNotFound,
  errorUnknownCode,
  errorUpstreamAuthRejected,
  errorUpstreamUnreachable,
  errorWithDetail,
  serversSingle,
  statusPaused,
  statusRunning,
  statusStale,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { ServerContext } from "../servers/ServerContext";
import { StatusBanners } from "./StatusBanners";

function renderBanners() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <StatusBanners />
    </ServerContext>,
  );
}

function statusReturns(body: unknown, status = 200) {
  server.use(http.get(endpoints.status.route, () => HttpResponse.json(body as object, { status })));
}

describe("StatusBanners", () => {
  it("shows a status while the first snapshot loads", async () => {
    server.use(
      http.get(endpoints.status.route, async () => {
        await delay(50);
        return HttpResponse.json(statusRunning);
      }),
    );
    renderBanners();
    expect(screen.getByRole("status")).toHaveTextContent("Loading server status");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("shows no banner for a fresh, running server", async () => {
    const { client, container } = renderBanners();
    await waitFor(() => expect(client.getQueryData(queries.status("default").queryKey)).toEqual(statusRunning));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stale banner with observedAt in local time", async () => {
    statusReturns(statusStale);
    renderBanners();
    const expected = new Date(statusStale.observedAt).toLocaleString();
    expect(await screen.findByText(`Showing last known data from ${expected}.`)).toBeInTheDocument();
    expect(screen.queryByText(/Paused/)).not.toBeInTheDocument();
  });

  it("shows the paused banner, separate from stale", async () => {
    statusReturns(statusPaused);
    renderBanners();
    expect(await screen.findByText("Paused: no players connected, values are frozen.")).toBeInTheDocument();
    expect(screen.queryByText(/last known data/)).not.toBeInTheDocument();
  });

  it("shows both banners when stale and paused", async () => {
    statusReturns({ ...statusPaused, stale: true });
    renderBanners();
    expect(await screen.findByText(/Paused: no players connected/)).toBeInTheDocument();
    expect(screen.getByText(/Showing last known data/)).toBeInTheDocument();
  });

  it.each([
    ["game server unreachable", errorUpstreamUnreachable, 502, "Game server unreachable."],
    [
      "rejected game-server credentials",
      errorUpstreamAuthRejected,
      502,
      "The dashboard's credentials for the game server were rejected. Check the backend's server token.",
    ],
    ["other game-server errors", errorWithDetail, 502, "The game server returned an error."],
    ["client bugs", errorNotFound, 404, "Something went wrong in the dashboard."],
    ["unknown codes, using the backend's message", errorUnknownCode, 500, errorUnknownCode.error.message],
  ] as const)("shows %s with the request ID", async (_, body, status, message) => {
    statusReturns(body, status);
    renderBanners();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent(`Request ID: ${body.error.requestId}`);
  });

  it("shows contract drift with the endpoint", async () => {
    statusReturns({ ...statusRunning, data: { ...statusRunning.data, gamePaused: "no" } });
    renderBanners();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "doesn't understand from /api/servers/default/status",
    );
  });

  it("shows when the dashboard backend can't be reached", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.error()));
    renderBanners();
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "Couldn't reach the dashboard backend.",
    );
  });
});

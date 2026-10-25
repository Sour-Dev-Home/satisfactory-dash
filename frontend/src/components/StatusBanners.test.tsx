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
  statusUnreachable,
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
  // #494: no loading line above the page; it would add a row and push the page down when it left.
  it("shows nothing while the first snapshot loads", async () => {
    server.use(
      http.get(endpoints.status.route, async () => {
        await delay(50);
        return HttpResponse.json(statusRunning);
      }),
    );
    const { container } = renderBanners();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await delay(150);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("shows game server unreachable without the request ID, keeping it for the dev tools", async () => {
    statusReturns(errorUpstreamUnreachable, 502);
    renderBanners();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).not.toHaveTextContent("Request ID");
    expect(alert).toHaveAttribute("data-request-id", errorUpstreamUnreachable.error.requestId);
  });

  // ADR-0052: a 200 that carries unreachableSince says it with the time, next to the last-known-data line.
  it("shows game server unreachable since the time when the snapshot says so, and the last-known-data line", async () => {
    statusReturns(statusUnreachable);
    renderBanners();
    const since = new Date(statusUnreachable.unreachableSince).toLocaleString();
    expect(await screen.findByText(`Game server unreachable since ${since}.`)).toBeInTheDocument();
    expect(screen.getByText(/Showing last known data from/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing about the game being unreachable for a stale snapshot without unreachableSince", async () => {
    statusReturns(statusStale);
    renderBanners();
    await screen.findByText(/Showing last known data/);
    expect(screen.queryByText(/Game server unreachable/)).not.toBeInTheDocument();
  });

  it("keeps the 503 path alongside: a failed refresh over cached unreachable data says it once", async () => {
    const { client } = renderBanners();
    await waitFor(() => expect(client.getQueryData(queries.status("default").queryKey)).toEqual(statusRunning));
    client.setQueryData(queries.status("default").queryKey, statusUnreachable);
    statusReturns(errorUpstreamUnreachable, 502);
    await client.refetchQueries({ queryKey: queries.status("default").queryKey });
    await screen.findByRole("alert");
    expect(screen.getAllByText(/Game server unreachable/)).toHaveLength(1);
  });

  it.each([
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

  it("says the dashboard is updating when the backend gives no response at all (ADR-0054 D4)", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.error()));
    renderBanners();
    expect(await screen.findByText("The dashboard is updating, back in a moment.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // The owner's report (2026-10-21): a status read that never answered went back to pending on each
  // poll, and the banner returned null until the poll failed again, so the row collapsed and came back.
  it("keeps the same unreachable notice up while a never-answered status read refetches", async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.status.route, async () => {
        calls += 1;
        if (calls > 1) await delay(100);
        return HttpResponse.json(errorUpstreamUnreachable, { status: 503 });
      }),
    );
    const { client } = renderBanners();
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Game server unreachable.");

    const refetch = client.refetchQueries({ queryKey: queries.status("default").queryKey });
    await waitFor(() => expect(client.isFetching()).toBe(1));
    // Mid-refetch the query is pending again, with its error cleared; the banner still says it.
    expect(client.getQueryState(queries.status("default").queryKey)?.status).toBe("pending");
    expect(screen.getByRole("alert")).toBe(notice);
    await refetch;
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByRole("alert")).toBe(notice);
    expect(calls).toBe(2);
  });

  // ADR-0054 D4: the edge answers while the backend is replaced. One "updating" line, the last data stays, the
  // "couldn't reach" error stays quiet, and the notice goes once the backend answers.
  it("says the dashboard is updating on a non-envelope 530 and keeps the last data, then clears", async () => {
    statusReturns(statusStale);
    const { client } = renderBanners();
    expect(await screen.findByText(/Showing last known data from/)).toBeInTheDocument();

    server.use(http.get(endpoints.status.route, () => HttpResponse.text("<!DOCTYPE html><title>Error 1033</title>", { status: 530 })));
    await client.refetchQueries({ queryKey: queries.status("default").queryKey });
    expect(await screen.findByText("The dashboard is updating, back in a moment.")).toBeInTheDocument();
    expect(screen.getAllByText(/back in a moment/)).toHaveLength(1);
    expect(screen.queryByText(/Couldn't reach the dashboard backend/)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing last known data from/)).toBeInTheDocument();

    statusReturns(statusRunning);
    await client.refetchQueries({ queryKey: queries.status("default").queryKey });
    await waitFor(() => expect(screen.queryByText(/back in a moment/)).not.toBeInTheDocument());
  });

  it("keeps \"Game server unreachable\" for the API's own 503, with no updating notice", async () => {
    statusReturns(errorUpstreamUnreachable, 503);
    renderBanners();
    expect(await screen.findByText("Game server unreachable.")).toBeInTheDocument();
    expect(screen.queryByText(/back in a moment/)).not.toBeInTheDocument();
  });

  it("keeps the old wording for a proxy page that isn't a deploy gap (500)", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.text("oops", { status: 500 })));
    renderBanners();
    expect(await screen.findByText("Couldn't reach the dashboard backend.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/back in a moment/)).not.toBeInTheDocument();
  });
});

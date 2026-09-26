import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, serversSingle, statusRunning, statusStale } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { StatusView } from "./StatusView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <StatusView />
    </ServerContext>,
  );
}

// StatusView has no loading/error UI of its own (that's StatusBanners' job, ADR-0004), so these
// only cover the panel it renders once data lands. Whether the data is late is the backend's
// call (`stale`) or a failed refresh, never this PC's clock (the architect's #249 note).
describe("StatusView's data-age warning", () => {
  afterEach(() => vi.useRealTimers());

  it("doesn't call fresh data late when this PC's clock is a day ahead", async () => {
    vi.setSystemTime(Date.parse(statusRunning.observedAt) + 86_400_000);
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusRunning)));
    renderView();
    expect(await screen.findByText(/^Updated 1 d /)).toBeInTheDocument();
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();
  });

  it("calls the data late when the backend says it's stale", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusStale)));
    renderView();
    expect(await screen.findByText(/newer data is overdue/)).toBeInTheDocument();
  });

  it("calls the data late when a refresh fails, and clears it once a refresh recovers", async () => {
    let fail = false;
    server.use(
      http.get(endpoints.status.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 503 }) : HttpResponse.json(statusRunning),
      ),
    );
    const { client } = renderView();
    await screen.findByRole("region", { name: "Server status" });
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();

    fail = true;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument());

    fail = false;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument());
  });
});

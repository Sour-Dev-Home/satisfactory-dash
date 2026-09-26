import { act, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, powerOk, powerStale, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerView } from "./PowerView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <PowerView />
    </ServerContext>,
  );
}

describe("PowerView", () => {
  it("shows a status while power loads, then the panel", async () => {
    server.use(
      http.get(endpoints.power.route, async () => {
        await delay(50);
        return HttpResponse.json(powerOk);
      }),
    );
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent("Loading power");
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
  });

  it("shows the error with its request ID when power can't be read", async () => {
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Game server unreachable.");
    expect(alert).toHaveTextContent(errorUpstreamUnreachable.error.requestId);
  });
});

// Whether the data is late is the backend's call (`stale`) or a failed refresh, never this PC's
// clock (the architect's #249 note).
describe("PowerView's data-age warning", () => {
  afterEach(() => vi.useRealTimers());

  it("doesn't call fresh data late when this PC's clock is a day ahead", async () => {
    vi.setSystemTime(Date.parse(powerOk.observedAt) + 86_400_000);
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerOk)));
    renderView();
    expect(await screen.findByText(/^Updated 1 d /)).toBeInTheDocument();
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();
  });

  it("calls the data late when the backend says it's stale", async () => {
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerStale)));
    renderView();
    expect(await screen.findByText(/newer data is overdue/)).toBeInTheDocument();
  });

  it("calls the data late when a refresh fails and the last snapshot stays on screen", async () => {
    let fail = false;
    server.use(
      http.get(endpoints.power.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 503 }) : HttpResponse.json(powerOk),
      ),
    );
    const { client } = renderView();
    await screen.findByRole("region", { name: "Power" });
    expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument();

    fail = true;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Power" })).toBeInTheDocument();
  });

  it("clears the warning once a refresh recovers after a failed one", async () => {
    let fail = false;
    server.use(
      http.get(endpoints.power.route, () =>
        fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 503 }) : HttpResponse.json(powerOk),
      ),
    );
    const { client } = renderView();
    await screen.findByRole("region", { name: "Power" });

    fail = true;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument());

    fail = false;
    await act(() => client.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.queryByText(/newer data is overdue/)).not.toBeInTheDocument());
  });
});

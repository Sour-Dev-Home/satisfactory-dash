import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type PowerResponse, type StatusResponse } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, powerOk, statusPaused } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

// Fresh-eyes pass: a poll that fails after data has already been shown.

describe("a failed poll after a successful one", () => {
  it("keeps the last values on screen alongside the error, for status and power", async () => {
    let fail = false;
    const failing = (body: StatusResponse | PowerResponse) => () =>
      fail ? HttpResponse.json(errorUpstreamUnreachable, { status: 503 }) : HttpResponse.json(body);
    server.use(
      http.get(endpoints.status.route, failing(statusPaused)),
      http.get(endpoints.power.route, failing(powerOk)),
    );
    // The Power page: the server banners (status) show above every page.
    window.history.pushState(null, "", "/app/power");
    const { client } = renderWithClient(<App />);
    await screen.findByText("Paused: no players connected, values are frozen.");
    await screen.findByRole("heading", { name: "Power", level: 3 });

    fail = true;
    await act(() => client.refetchQueries({ type: "active" }));

    // Error shown, previous snapshot (and its paused banner) still visible.
    await waitFor(() => expect(screen.getAllByText("Game server unreachable.")).toHaveLength(2));
    expect(screen.getByText("Paused: no players connected, values are frozen.")).toBeInTheDocument();
    const power = screen.getByRole("region", { name: "Power" });
    expect(within(power).getByRole("article", { name: `Circuit ${powerOk.data.circuits[0].circuitGroupId}` })).toBeInTheDocument();
  });
});

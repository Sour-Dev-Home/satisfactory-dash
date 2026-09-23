import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorServerNotFound, serversSingle } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

// Fresh-eyes pass: a server that disappears while every view is polling it.

describe("ServerGate with every view mounted", () => {
  it("re-runs discovery a bounded number of times when all views answer server_not_found", async () => {
    let discoveries = 0;
    const lost = () => HttpResponse.json(errorServerNotFound, { status: 404 });
    server.use(
      http.get(endpoints.servers.route, () => {
        discoveries++;
        return HttpResponse.json(serversSingle);
      }),
      http.get(endpoints.status.route, lost),
      http.get(endpoints.power.route, lost),
      http.get(endpoints.factory.route, lost),
      http.get(endpoints.settings.get.route, lost),
    );
    renderWithClient(<App />);
    expect(await screen.findByRole("heading", { name: "Choose a game server" })).toBeInTheDocument();
    await delay(100);
    // One initial discovery; rediscovery must not loop. Each of the four views can trigger
    // at most one re-run before the selection is dropped.
    expect(discoveries).toBeGreaterThanOrEqual(2);
    expect(discoveries).toBeLessThanOrEqual(5);
    expect(screen.getByRole("alert")).toHaveTextContent("The selected server is no longer available.");
  });
});

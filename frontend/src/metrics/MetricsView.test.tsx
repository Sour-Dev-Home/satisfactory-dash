import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type MetricsOverview } from "@satisfactory-dash/shared";
import {
  errorForbidden,
  errorRateLimited,
  errorServiceUnavailable,
  metricsOverviewAvailable,
  metricsOverviewUnavailable,
} from "@satisfactory-dash/shared/fixtures";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { MetricsView } from "./MetricsView";

function renderView() {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/metrics"]}>
      <Routes>
        <Route path="/app/metrics" element={<MetricsView />} />
        <Route path="/app" element={<p>Overview page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const answer = (body: MetricsOverview) => http.get(endpoints.metrics.overview.route, () => HttpResponse.json(body));

describe("MetricsView", () => {
  it("shows the system, alert and delivery sections, with percentiles as bucket bounds", async () => {
    renderView();
    const system = await screen.findByRole("region", { name: "System" });
    expect(within(system).getByText("p95")).toBeInTheDocument();
    // The fixture's p99 fell in the open-ended last bucket.
    expect(within(system).getByText("> 5 s")).toBeInTheDocument();
    expect(within(system).getByText("≤ 2 ms")).toBeInTheDocument();
    expect(within(system).getByText("abc123")).toBeInTheDocument();
    const alerts = screen.getByRole("region", { name: "Alert quality" });
    expect(within(alerts).getByText("Power outage")).toBeInTheDocument();
    expect(within(alerts).getByText("None resolved")).toBeInTheDocument();
    expect(within(alerts).getByText(/stand-in/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Delivery and CI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Latency probe runs/ })).toHaveAttribute("href", metricsOverviewAvailable.links.probeRuns);
  });

  it("asks for the 24 h window first and again for each window the switcher picks", async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get(endpoints.metrics.overview.route, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("window"));
        return HttpResponse.json(metricsOverviewAvailable);
      }),
    );
    renderView();
    await screen.findByRole("region", { name: "System" });
    expect(screen.getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "7 d" }));
    await waitFor(() => expect(seen).toEqual(["24h", "7d"]));
    expect(screen.getByRole("button", { name: "7 d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "false");
    // The last answer stays up while the next loads, so the page doesn't blank.
    expect(screen.getByRole("region", { name: "System" })).toBeInTheDocument();
  });

  it("says why each section is empty, in its own words", async () => {
    server.use(answer(metricsOverviewUnavailable));
    renderView();
    const system = await screen.findByRole("region", { name: "System" });
    expect(system.querySelector("[data-unavailable='no_data']")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Alert quality" }).querySelector("[data-unavailable='not_built']")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Delivery and CI" }).querySelector("[data-unavailable='not_configured']")).not.toBeNull();
    // Whatever is missing, the links to where the numbers live stay.
    expect(screen.getByRole("link", { name: /Public status page/ })).toBeInTheDocument();
  });

  it("explains a delivery feed that isn't built yet and still links the probe runs", async () => {
    server.use(answer({ ...metricsOverviewAvailable, delivery: { available: false, reason: "not_built" } }));
    renderView();
    const delivery = await screen.findByRole("region", { name: "Delivery and CI" });
    expect(within(delivery).getByText(/aren't collected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Latency probe runs/ })).toBeInTheDocument();
  });

  it("says nothing was recorded when an available section has no rows", async () => {
    server.use(
      answer({
        ...metricsOverviewAvailable,
        system: { ...metricsOverviewAvailable.system, histograms: [], counters: [], servers: [] },
        alerts: { ...metricsOverviewAvailable.alerts, months: [] },
      }),
    );
    renderView();
    const system = await screen.findByRole("region", { name: "System" });
    expect(system.querySelector("[data-unavailable='no_data']")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Alert quality" }).querySelector("[data-unavailable='no_data']")).not.toBeNull();
  });

  it("treats a 403 as an unknown page: it redirects and shows nothing about metrics", async () => {
    server.use(http.get(endpoints.metrics.overview.route, () => HttpResponse.json(errorForbidden, { status: 403 })));
    renderView();
    expect(await screen.findByText("Overview page")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "System" })).not.toBeInTheDocument();
  });

  it("answers a 429 with a calm note and a way to try again, not an alert", async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.metrics.overview.route, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(errorRateLimited, { status: 429, headers: { "Retry-After": "60" } })
          : HttpResponse.json(metricsOverviewAvailable);
      }),
    );
    renderView();
    const note = await screen.findByText(/asked for too often/);
    expect(note).toHaveTextContent("Try again in a minute.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "System" })).toBeInTheDocument();
  });

  it("shows another failure as an error with Retry", async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.metrics.overview.route, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json(errorServiceUnavailable, { status: 503 }) : HttpResponse.json(metricsOverviewAvailable);
      }),
    );
    renderView();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("region", { name: "System" })).toBeInTheDocument();
  });

  it("shows a skeleton while the first read is out, never a Loading line above content", async () => {
    server.use(http.get(endpoints.metrics.overview.route, () => new Promise<never>(() => {})));
    renderView();
    await waitFor(() => expect(document.querySelector("[data-loadable]")).not.toBeNull());
    expect(screen.queryByRole("region", { name: "System" })).not.toBeInTheDocument();
  });

  it("refreshes on request", async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.metrics.overview.route, () => {
        calls += 1;
        return HttpResponse.json(metricsOverviewAvailable);
      }),
    );
    renderView();
    await screen.findByRole("region", { name: "System" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("never shows a server's name, only its public id", async () => {
    renderView();
    await screen.findByRole("region", { name: "System" });
    expect(screen.getByRole("columnheader", { name: "Server" })).toBeInTheDocument();
  });
});

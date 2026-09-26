import { fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, historyPower24h, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PowerHistorySection } from "./PowerHistorySection";
import { missingStretches } from "./storedHistory";

function renderSection() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <PowerHistorySection />
    </ServerContext>,
  );
}

const picker = () => screen.getByRole("group", { name: "Power history range" });
const choose = (label: string) => fireEvent.click(within(picker()).getByRole("button", { name: label }));

describe("PowerHistorySection", () => {
  it("starts on the live chart, with Live pressed", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { name: "Last 5 minutes" })).toBeInTheDocument();
    expect(within(picker()).getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
  });

  it("asks the backend for the chosen range and shows the stored history", async () => {
    const asked: string[] = [];
    server.use(
      http.get(endpoints.history.power.route, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("range") ?? "");
        return HttpResponse.json(historyPower24h);
      }),
    );
    renderSection();
    choose("24 h");
    expect(await screen.findByRole("heading", { name: "Last 24 hours" })).toBeInTheDocument();
    expect(asked).toEqual(["24h"]);
    expect(within(picker()).getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/5-minute averages/)).toBeInTheDocument();
  });

  it("shows only the newest game session and says the older one is hidden", async () => {
    renderSection();
    choose("24 h");
    await screen.findByRole("heading", { name: "Last 24 hours" });
    const circuits = screen.getAllByRole("article");
    const newest = historyPower24h.data.series[0];
    const newestCount = historyPower24h.data.series.filter((s) => s.session === newest.session).length;
    expect(circuits).toHaveLength(newestCount);
    expect(screen.getByText(/An earlier game session in this range isn't shown/)).toBeInTheDocument();
  });

  it("says when the fuse tripped, and lists each bucket in the table", async () => {
    renderSection();
    choose("24 h");
    await screen.findByRole("heading", { name: "Last 24 hours" });
    expect(screen.getByText(/Fuse tripped between/)).toBeInTheDocument();
    const { points } = historyPower24h.data.series[0];
    const missing = missingStretches(points, historyPower24h.data.resolutionSeconds);
    expect(missing.length).toBeGreaterThan(0);
    const table = screen.getByRole("table");
    // One row per bucket, plus one "No data recorded" row per gap.
    expect(table.querySelectorAll("tbody tr")).toHaveLength(points.length + missing.length);
    expect(within(table).getAllByText("No data recorded")).toHaveLength(missing.length);
    expect(within(table).getByText("Tripped")).toHaveClass("text-bad");
  });

  it("lists the stretches with no data in text, since the chart is hidden from screen readers", async () => {
    renderSection();
    choose("24 h");
    await screen.findByRole("heading", { name: "Last 24 hours" });
    expect(screen.getByText(/^No data recorded:/)).toBeInTheDocument();
  });

  it("badges the circuit when its newest bucket tripped the fuse", async () => {
    expect(historyPower24h.data.series[0].points.at(-1)!.fuseTrippedSamples).toBeGreaterThan(0);
    renderSection();
    choose("24 h");
    expect(await screen.findByRole("heading", { name: /Circuit \d+ Fuse tripped/ })).toBeInTheDocument();
  });

  it("has no fuse badge when the newest bucket is fine, even if an earlier one tripped", async () => {
    const [first, ...rest] = historyPower24h.data.series;
    const step = historyPower24h.data.resolutionSeconds * 1000;
    const last = first.points.at(-1)!;
    const recovered = { ...first, points: [...first.points, { ...last, t: last.t + step, fuseTrippedSamples: 0 }] };
    server.use(
      http.get(endpoints.history.power.route, () =>
        HttpResponse.json({ ...historyPower24h, data: { ...historyPower24h.data, series: [recovered, ...rest] } }),
      ),
    );
    renderSection();
    choose("24 h");
    await screen.findByRole("heading", { name: "Last 24 hours" });
    expect(screen.getByText(/Fuse tripped between/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Fuse tripped/ })).not.toBeInTheDocument();
  });

  it("says so when the range has no recorded history yet", async () => {
    server.use(
      http.get(endpoints.history.power.route, () =>
        HttpResponse.json({ ...historyPower24h, data: { ...historyPower24h.data, range: "1h", series: [] } }),
      ),
    );
    renderSection();
    choose("1 h");
    expect(await screen.findByText("No power history recorded in this range yet.")).toBeInTheDocument();
  });

  it("shows an error with a retry when the history can't load", async () => {
    server.use(http.get(endpoints.history.power.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    renderSection();
    choose("7 d");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("goes back to the live chart", async () => {
    renderSection();
    choose("24 h");
    await screen.findByRole("heading", { name: "Last 24 hours" });
    choose("Live");
    expect(await screen.findByRole("heading", { name: "Last 5 minutes" })).toBeInTheDocument();
  });
});

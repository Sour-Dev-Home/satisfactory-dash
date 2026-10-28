import { act, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints, type Bottleneck, type Bottlenecks } from "@satisfactory-dash/shared";
import { bottlenecksBeltLevel, bottlenecksEmpty, errorUpstreamAuthRejected, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { BottleneckSummary, BottleneckSummarySkeleton, BottleneckSummaryView } from "./BottleneckSummary";
import { BOTTLENECK_SUMMARY_CAP, BOTTLENECKS_ANCHOR } from "./bottlenecksRead";

// One macrotask before cleanup lets responses already sent settle (see FactoryView.test.tsx, #386).
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const base = bottlenecksBeltLevel.data;

/** Five causes, ranked as the backend sends them. */
function fiveCauses(): Bottlenecks {
  const findings: Bottleneck[] = Array.from({ length: 5 }, (_, i) => ({
    ...base.findings[i % base.findings.length],
    buildingId: `b${i}`,
    buildingName: `Machine ${i + 1}`,
    recipe: null,
    at: undefined,
    affectedCount: undefined,
  }));
  return { ...base, findings };
}

function renderSummary(data: Bottlenecks, entry = "/app/factory") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <BottleneckSummary data={data} />
    </MemoryRouter>,
  );
}

function renderView() {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/factory"]}>
      <ServerContext value={serversSingle.servers[0]}>
        <BottleneckSummaryView />
      </ServerContext>
    </MemoryRouter>,
  );
}

/** The box's lines (causes, the calm line, skeleton rows, pads): always the cap, so its height never changes. */
const lines = (box: HTMLElement) => box.querySelectorAll(".min-h-lh");

describe("BottleneckSummary", () => {
  it("shows the count and the causes in the backend's rank order, state first", () => {
    renderSummary(base);
    expect(screen.getByRole("heading", { name: "3 bottlenecks" })).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Worst bottlenecks" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(
      base.findings.map((f) => expect.stringMatching(new RegExp(`^(Underfed|Backed up) · ${f.buildingName}`))),
    );
    expect(items[0]).toHaveTextContent("Underfed · Constructor, Concrete, near (−560, −1290)");
    expect(items[1]).toHaveTextContent(/^Backed up · Refinery/);
    // A shared cause says how many machines it holds back.
    expect(items[2]).toHaveTextContent("· 61 machines");
  });

  it("names at most the cap, the first ones, and counts them all", () => {
    renderSummary(fiveCauses());
    expect(screen.getByRole("heading", { name: "5 bottlenecks" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(BOTTLENECK_SUMMARY_CAP);
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Machine 1"),
      expect.stringContaining("Machine 2"),
      expect.stringContaining("Machine 3"),
    ]);
  });

  it("says the backend cut the list rather than undercounting", () => {
    renderSummary({ ...fiveCauses(), truncated: true });
    expect(screen.getByRole("heading", { name: "5+ bottlenecks" })).toBeInTheDocument();
  });

  it("one calm line and no link when there are none", () => {
    renderSummary(bottlenecksEmpty.data);
    expect(screen.getByRole("heading", { name: "No bottlenecks" })).toBeInTheDocument();
    expect(screen.getByText("No machine is underfed or backed up.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("links to the full list's id, keeping the page's search", () => {
    renderSummary(base, "/app/factory?q=smelter");
    const link = screen.getByRole("link", { name: "Full list of bottlenecks" });
    expect(link).toHaveAttribute("href", `/app/factory?q=smelter#${BOTTLENECKS_ANCHOR}`);
  });

  it("pads to the cap, so one cause, none, three and the skeleton all stand the same height", () => {
    const one = renderSummary({ ...base, findings: base.findings.slice(0, 1) });
    expect(lines(one.container)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
    one.unmount();
    const none = renderSummary(bottlenecksEmpty.data);
    expect(lines(none.container)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
    none.unmount();
    const five = renderSummary(fiveCauses());
    expect(lines(five.container)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
    five.unmount();
    const skeleton = render(<BottleneckSummarySkeleton />);
    expect(lines(skeleton.container)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
  });

  it("cuts a long line with an ellipsis instead of wrapping it", () => {
    renderSummary(base);
    for (const li of screen.getAllByRole("listitem")) expect(li).toHaveClass("truncate");
  });
});

describe("BottleneckSummaryView", () => {
  it("fills from the bottlenecks read", async () => {
    renderView();
    expect(await screen.findByRole("heading", { name: "3 bottlenecks" })).toBeInTheDocument();
  });

  it("keeps its box while the read is pending, with no visible loading line", () => {
    server.use(http.get(endpoints.bottlenecks.route, () => new Promise<never>(() => {})));
    const { container } = renderView();
    const box = container.querySelector("section[aria-busy='true']");
    expect(box).not.toBeNull();
    expect(lines(box as HTMLElement)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
    // The words are for screen readers only (frontend/CLAUDE.md "Loading"): never a "Loading…" line above content.
    for (const node of within(container).queryAllByText(/Loading/)) expect(node).toHaveClass("sr-only");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows the panel error over a box of the same size when the read fails", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(errorUpstreamAuthRejected, { status: 502 })));
    const { container } = renderView();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const sizer = container.querySelector("[aria-hidden='true'].invisible");
    expect(sizer).not.toBeNull();
    expect(lines(sizer as HTMLElement)).toHaveLength(BOTTLENECK_SUMMARY_CAP);
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints, type Bottleneck, type Bottlenecks } from "@satisfactory-dash/shared";
import {
  bottlenecksBeltLevel,
  bottlenecksEmpty,
  bottlenecksItemLevelOldFrm,
  bottlenecksUnknownKind,
  errorUpstreamAuthRejected,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { BottleneckSummary, BottleneckSummarySkeleton, BottleneckSummaryView } from "./BottleneckSummary";
import { BOTTLENECK_SUMMARY_CAP, BOTTLENECKS_ANCHOR } from "./bottlenecksRead";

// One macrotask before cleanup lets responses already sent settle (see FactoryView.test.tsx, #386).
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const raw = bottlenecksBeltLevel.data;
/** The fixture's third cause, a shared deficit, is 27 short of 2453 (1.1%): a small gap the page leaves out (ADR-0064). */
const small = raw.findings[2];
/** The same cause with a real gap: 400 short. */
const wide: Bottleneck = { ...small, rootCause: { ...small.rootCause, supplyMaxPerMinute: 2053 } };
/** The fixture with its shared cause widened, so all three show. */
const base: Bottlenecks = { ...raw, findings: [raw.findings[0], raw.findings[1], wide] };

/** Five causes, ranked as the backend sends them (none a small gap). */
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

function renderView(entry = "/app/factory") {
  return renderWithClient(
    <MemoryRouter initialEntries={[entry]}>
      <ServerContext value={serversSingle.servers[0]}>
        <BottleneckSummaryView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const answer = (body: JsonBodyType) => server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(body)));
const fullListButton = () => screen.getByRole("button", { name: "Full list of bottlenecks" });
const openFullList = () => fireEvent.click(fullListButton());
/** The full list: its ordered list is named by the card's heading. */
const fullList = (count: string) => screen.getByRole("list", { name: count });

/** The box's lines (causes, the calm line, skeleton rows, pads): always the cap, so its height never changes. */
const lines = (box: HTMLElement) => box.querySelectorAll(".min-h-lh");

describe("BottleneckSummary", () => {
  it("shows the count and the causes in the backend's rank order, state first, without their place", () => {
    renderSummary(base);
    expect(screen.getByRole("heading", { name: "3 bottlenecks" })).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Worst bottlenecks" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(
      base.findings.map((f) => expect.stringMatching(new RegExp(`^(Underfed|Backed up) · ${f.buildingName}`))),
    );
    // ADR-0064: the place is the full list's, not the summary's.
    expect(items[0]).toHaveTextContent("Underfed · Constructor, Concrete");
    expect(items[0]).not.toHaveTextContent("near");
    expect(items[1]).toHaveTextContent(/^Backed up · Refinery/);
    // A shared cause says how many machines it holds back.
    expect(items[2]).toHaveTextContent("· 61 machines");
  });

  it("leaves out a gap under 2% from the count, the lines and the full list", () => {
    renderSummary(raw);
    expect(screen.getByRole("heading", { name: "2 bottlenecks" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    openFullList();
    expect(within(fullList("2 bottlenecks")).queryByText(/Iron Plate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clock rounding/)).not.toBeInTheDocument();
  });

  it("says all is well when every cause is a small gap", () => {
    renderSummary({ ...raw, findings: [small] });
    expect(screen.getByRole("heading", { name: "No bottlenecks" })).toBeInTheDocument();
    expect(screen.getByText("All machines are fed and flowing.")).toBeInTheDocument();
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

  it("one calm line and no button when there is nothing to list", () => {
    renderSummary({ ...bottlenecksEmpty.data, notes: [], beltData: "present" });
    expect(screen.getByRole("heading", { name: "No bottlenecks" })).toBeInTheDocument();
    expect(screen.getByText("All machines are fed and flowing.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
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

  it("keeps each cause on one line, cutting only the machine's name so the state and the count stay", () => {
    renderSummary(base);
    for (const li of screen.getAllByRole("listitem")) {
      expect(li).toHaveClass("whitespace-nowrap");
      const parts = [...li.children];
      expect(parts.filter((p) => p.classList.contains("truncate"))).toEqual([li.querySelector("[data-machine]")]);
      for (const p of parts) if (!p.hasAttribute("data-machine")) expect(p).toHaveClass("shrink-0");
    }
  });

  it("names the region the same whatever the count", () => {
    renderSummary(base);
    expect(screen.getByRole("region", { name: "Bottlenecks" })).toBeInTheDocument();
  });
});

describe("the full list, in the same card (ADR-0064)", () => {
  it("opens in place of the summary lines and closes again", () => {
    renderSummary(base);
    const button = fullListButton();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(button.getAttribute("aria-controls")!)).not.toBeNull();
    openFullList();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("list", { name: "Worst bottlenecks" })).not.toBeInTheDocument();
    expect(document.getElementById(BOTTLENECKS_ANCHOR)).not.toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("list", { name: "Worst bottlenecks" })).toBeInTheDocument();
    expect(document.getElementById(BOTTLENECKS_ANCHOR)).toBeNull();
  });

  it("lists the findings in rank order with their place and the backend's sentence, and no repeated cap line", () => {
    renderSummary(base);
    openFullList();
    const items = [...fullList("3 bottlenecks").children] as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Constructor, Concrete, near (−560, −1290) · Underfed");
    expect(items[0]).toHaveTextContent(base.findings[0].text);
    // The sentence names the conveyor, its rate and its place: no "Capped by" line repeats it.
    expect(items[0]).toHaveTextContent("Conveyor Belt Mk.1");
    expect(screen.queryByText(/Capped by/)).not.toBeInTheDocument();
    // One cause, so no machine list.
    expect(within(items[0]).queryByText(/Affects/)).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Refinery · Backed up");
  });

  it("one row per shared cause: the fix, and the machines it affects (#592)", () => {
    renderSummary(base);
    openFullList();
    const row = fullList("3 bottlenecks").children[2] as HTMLElement;
    expect(row).toHaveTextContent("Constructor, Iron Plate, near (1204, −388) · Underfed");
    expect(row).toHaveTextContent("Fix: About 1 more Smelter (Iron Ingot), 30 items/min each, at full speed.");
    expect(within(row).getByText("Affects 61 machines")).toBeInTheDocument();
    const machines = [...row.querySelectorAll("details li")].map((li) => li.textContent);
    expect(machines).toEqual([
      "Constructor, Iron Plate, near (1204, −388)",
      "Constructor, Iron Rod, near (1214, −388)",
      "Constructor, Screw, near (1224, −388)",
      "and 58 more",
    ]);
    // ADR-0064: how often connections refresh is not said.
    expect(screen.queryByText(/Connections refresh/)).not.toBeInTheDocument();
  });

  it("an older FRM: the update note is in the full list", () => {
    renderSummary(bottlenecksItemLevelOldFrm.data);
    openFullList();
    expect(screen.getByText(/Update FRM to 1\.5\.4/)).toBeInTheDocument();
    expect(screen.queryByText(/Capped by/)).not.toBeInTheDocument();
  });

  it("with no causes but a note, the button still opens the note", () => {
    renderSummary({ ...bottlenecksEmpty.data, findings: [], beltData: "unsupported", notes: [] });
    expect(screen.getByText("All machines are fed and flowing.")).toBeInTheDocument();
    openFullList();
    expect(screen.getByText(/Update FRM to 1\.5\.4/)).toBeInTheDocument();
  });

  it("shows only the text for an unknown step kind, and says the list was cut", () => {
    renderSummary(bottlenecksUnknownKind.data);
    openFullList();
    expect(screen.getByText(/smart splitter upstream filters Limestone/)).toBeInTheDocument();
    expect(screen.getByText("A note a newer backend adds.")).toBeInTheDocument();
    expect(screen.getByText(/Showing the top 10/)).toBeInTheDocument();
  });

  it("a link to #bottlenecks or #bottlenecks-heading opens it", () => {
    const list = renderSummary(base, `/app/factory#${BOTTLENECKS_ANCHOR}`);
    expect(fullListButton()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(BOTTLENECKS_ANCHOR)).not.toBeNull();
    list.unmount();
    renderSummary(base, "/app/factory#bottlenecks-heading");
    expect(fullListButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "3 bottlenecks" })).toHaveAttribute("id", "bottlenecks-heading");
  });
});

describe("BottleneckSummaryView", () => {
  it("fills from the bottlenecks read", async () => {
    renderView();
    // The default read's third cause is a small gap.
    expect(await screen.findByRole("heading", { name: "2 bottlenecks" })).toBeInTheDocument();
  });

  it("says so when nothing is underfed or backed up", async () => {
    answer(bottlenecksEmpty);
    renderView();
    expect(await screen.findByText("All machines are fed and flowing.")).toBeInTheDocument();
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

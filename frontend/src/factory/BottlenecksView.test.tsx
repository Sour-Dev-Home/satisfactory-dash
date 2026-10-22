import { act, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
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
import { BottlenecksView } from "./BottlenecksView";

// One macrotask before cleanup lets responses already sent settle (see FactoryView.test.tsx, #386).
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <BottlenecksView />
    </ServerContext>,
  );
}

const answer = (body: JsonBodyType) => server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(body)));

describe("BottlenecksView", () => {
  it("lists the findings in rank order with the sentence, the state and the capping conveyor", async () => {
    renderView();
    const list = await screen.findByRole("list", { name: "Bottlenecks" });
    const items = [...list.children] as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Constructor, Concrete, near (−560, −1290) · Underfed");
    expect(items[0]).toHaveTextContent(bottlenecksBeltLevel.data.findings[0].text);
    expect(items[0]).toHaveTextContent("Capped by: Conveyor Belt Mk.1 · 60 items/min · near (−554, −1278)");
    // One cause, so no machine list.
    expect(within(items[0]).queryByText(/Affects/)).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Refinery · Backed up");
  });

  it("one row per shared cause: the fix, and the machines it affects (#592)", async () => {
    renderView();
    const list = await screen.findByRole("list", { name: "Bottlenecks" });
    const row = list.children[2] as HTMLElement;
    expect(row).toHaveTextContent("Constructor, Iron Plate, near (1204, −388) · Underfed");
    expect(row).toHaveTextContent("Fix: About 1 more Smelter (Iron Ingot), 30 items/min each, at full speed.");
    // 27 short of 2453 is 1.1%: may be clock rounding.
    expect(row).toHaveTextContent(/may be clock rounding/);
    expect(within(row).getByText("Affects 61 machines")).toBeInTheDocument();
    const machines = [...row.querySelectorAll("details li")].map((li) => li.textContent);
    expect(machines).toEqual([
      "Constructor, Iron Plate, near (1204, −388)",
      "Constructor, Iron Rod, near (1214, −388)",
      "Constructor, Screw, near (1224, −388)",
      "and 58 more",
    ]);
    expect(screen.getByRole("heading", { name: "Bottlenecks" })).toBeInTheDocument();
    expect(screen.getByText("Connections refresh every 10 minutes.")).toBeInTheDocument();
  });

  it("keeps the section for an older FRM, with the update note and no cap line", async () => {
    answer(bottlenecksItemLevelOldFrm);
    renderView();
    expect(await screen.findByText(/Update FRM to 1\.5\.4/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Capped by/)).not.toBeInTheDocument();
  });

  it("says so when nothing is underfed or backed up", async () => {
    answer(bottlenecksEmpty);
    renderView();
    expect(await screen.findByText(/No bottlenecks/)).toBeInTheDocument();
  });

  it("shows only the text for an unknown step kind, and says the list was cut", async () => {
    answer(bottlenecksUnknownKind);
    renderView();
    expect(await screen.findByText(/smart splitter upstream filters Limestone/)).toBeInTheDocument();
    expect(screen.queryByText(/Capped by/)).not.toBeInTheDocument();
    expect(screen.getByText("A note a newer backend adds.")).toBeInTheDocument();
    expect(screen.getByText(/Showing the top 10/)).toBeInTheDocument();
  });

  it("shows an error in the section only when the read fails", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(errorUpstreamAuthRejected, { status: 502 })));
    renderView();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

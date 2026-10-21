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
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Constructor · Underfed");
    expect(items[0]).toHaveTextContent(bottlenecksBeltLevel.data.findings[0].text);
    expect(items[0]).toHaveTextContent("Capped by: Conveyor Belt Mk.1 · 60 items/min · near (−554, −1278)");
    expect(items[1]).toHaveTextContent("Refinery · Backed up");
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

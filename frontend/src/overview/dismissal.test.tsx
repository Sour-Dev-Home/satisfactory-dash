import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { factoryEmpty, powerAtRisk, powerOutage, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { OverviewView } from "./OverviewView";

// The owner's call: the warnings banner can be hidden "until something changes". The default
// handlers give one warning: Factory degraded (2 of 5 machines backed up).

const DISMISS = { name: "Hide this warning until something changes" };

function renderOverview() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <OverviewView />
      </ServerContext>
    </MemoryRouter>,
  );
}

async function refetchAll(client: ReturnType<typeof renderOverview>["client"]) {
  await act(() => client.refetchQueries({ type: "active" }));
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("dismissing the warnings banner", () => {
  it("hides the banner but keeps the section rows", async () => {
    renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Sections" })).toHaveTextContent("Degraded");
  });

  it("stays hidden on a reload while the same warnings last", async () => {
    const first = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    first.unmount();

    renderOverview();
    await screen.findByText("2 of 5 machines backed up");
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
  });

  it("comes back when another section starts warning", async () => {
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));

    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerAtRisk)));
    await refetchAll(client);
    expect(await screen.findByText("Running with warnings")).toBeInTheDocument();
  });

  it("can't hide an outage, and an outage shows even after a dismissal", async () => {
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));

    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerOutage)));
    await refetchAll(client);
    expect(await screen.findByText("Power outage")).toBeInTheDocument();
    expect(screen.queryByRole("button", DISMISS)).not.toBeInTheDocument();
  });

  it("forgets the dismissal once all is clear, so the same warning shows again later", async () => {
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));

    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryEmpty)));
    await refetchAll(client);
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    expect(screen.queryByRole("button", DISMISS)).not.toBeInTheDocument();

    server.resetHandlers();
    await refetchAll(client);
    expect(await screen.findByText("Running with warnings")).toBeInTheDocument();
  });

  it("still hides for this visit when the browser won't store it", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
  });

  it("keeps each server's dismissal apart", async () => {
    renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(window.localStorage.getItem(`satis-manager.dismissed-warning.${serversSingle.servers[0].id}`)).toBe(
      "Factory:degraded",
    );
  });
});

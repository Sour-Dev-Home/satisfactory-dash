import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { factoryEmpty, powerAtRisk, powerOutage, serversSingle, statusSlow } from "@satisfactory-dash/shared/fixtures";
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
  it("hides the warning but keeps the Health card and the section rows", async () => {
    renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Health" })).toHaveTextContent("Warning hidden until something changes.");
    expect(screen.getByRole("list", { name: "Sections" })).toHaveTextContent("Degraded");
  });

  it("moves keyboard focus to the Health card's heading, never leaving it on <body>", async () => {
    renderOverview();
    const button = await screen.findByRole("button", DISMISS);
    button.focus();
    fireEvent.click(button);
    expect(button).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Health" }));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("stays hidden on a reload while the same warnings last", async () => {
    const first = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    first.unmount();

    renderOverview();
    await screen.findByText("2 of 5 machines backed up");
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
  });

  it("does not steal focus to the Health heading on a reload with an already-stored dismissal", async () => {
    // The focus move belongs only to a user's dismiss click. A remount that starts with the
    // banner already hidden (a stored dismissal from a previous visit) must not autofocus.
    const first = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    first.unmount();

    renderOverview();
    await screen.findByText("2 of 5 machines backed up");
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Health" }));
  });

  it("comes back when another section starts warning", async () => {
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));

    server.use(http.get(endpoints.power.route, () => HttpResponse.json(powerAtRisk)));
    await refetchAll(client);
    expect(await screen.findByText("Running with warnings")).toBeInTheDocument();
  });

  it("comes back when the tick turns slow, even though the tick has no row of its own", async () => {
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));

    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)));
    await refetchAll(client);
    expect(await screen.findByText("Running with warnings")).toBeInTheDocument();
  });

  it("stays dismissed across a refetch that reports the exact same tick warning again", async () => {
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryEmpty)),
    );
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();

    // Only the tick is warning here, and it comes back with the same health both times: the
    // dismissal must survive, since nothing about the warning itself changed.
    await refetchAll(client);
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
  });

  it("keeps a tick warning dismissed through a failed background refetch (data wins over error)", async () => {
    server.use(
      http.get(endpoints.status.route, () => HttpResponse.json(statusSlow)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryEmpty)),
    );
    const { client } = renderOverview();
    fireEvent.click(await screen.findByRole("button", DISMISS));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();

    server.use(http.get(endpoints.status.route, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    await act(() => client.refetchQueries({ type: "active" }).catch(() => undefined));
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
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

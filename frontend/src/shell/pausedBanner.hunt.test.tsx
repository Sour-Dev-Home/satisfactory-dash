import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { endpoints, type StatusResponse } from "@satisfactory-dash/shared";
import { statusPaused, statusSlow, statusStale } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

const PAUSED_BANNER = "Paused: no players connected, values are frozen.";

function pausedStatus(body: StatusResponse = statusPaused) {
  server.use(http.get(endpoints.status.route, () => HttpResponse.json(body)));
}

async function overviewRows() {
  return screen.findByRole("list", { name: "Sections" });
}

/** The wrapper the shell hides with `:not(:has(p,[role]))`; jsdom doesn't apply the CSS. */
function bannersWrapper() {
  const el = document.querySelector('[class*="has(p,[role])"]');
  if (!el) throw new Error("banners wrapper not found");
  return el;
}

describe("paused banner: which URLs count as the Overview", () => {
  it.each(["/elsewhere", "/app","/app/", "/app?x=1", "/app/?x=1#h", "/APP", "/app/nope"])(
    "%s ends on the Overview without the banner",
    async (path) => {
      pausedStatus();
      window.history.pushState(null, "", path);
      renderWithClient(<App />);
      const rows = await overviewRows();
      expect(await within(rows).findByText("Paused: no players connected")).toBeInTheDocument();
      expect(screen.queryByText(PAUSED_BANNER)).not.toBeInTheDocument();
    },
  );

  it.each(["/app/power", "/app/factory", "/app/settings", "/app/power/"])(
    "%s keeps the banner",
    async (path) => {
      pausedStatus();
      window.history.pushState(null, "", path);
      renderWithClient(<App />);
      expect(await screen.findByText(PAUSED_BANNER)).toBeInTheDocument();
    },
  );

  it("toggles on every navigation: Overview -> Power -> Overview -> Settings", async () => {
    pausedStatus();
    renderWithClient(<App />);
    await overviewRows();
    expect(screen.queryByText(PAUSED_BANNER)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Power" }));
    expect(await screen.findByText(PAUSED_BANNER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    await overviewRows();
    expect(screen.queryByText(PAUSED_BANNER)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByText(PAUSED_BANNER)).toBeInTheDocument();
  });
});

describe("paused banner: the banners wrapper", () => {
  it("has no p/[role] child on the Overview when paused is the only banner, so it collapses", async () => {
    pausedStatus();
    renderWithClient(<App />);
    await within(await overviewRows()).findByText("Paused: no players connected");
    expect(bannersWrapper().querySelector("p,[role]")).toBeNull();
  });

  it("keeps a child on Power when paused is the only banner", async () => {
    pausedStatus();
    window.history.pushState(null, "", "/app/power");
    renderWithClient(<App />);
    await screen.findByText(PAUSED_BANNER);
    expect(bannersWrapper().querySelector("p,[role]")).not.toBeNull();
  });
});

describe("paused banner: the Overview still says paused in every paused state", () => {
  it("after a failed refetch, cached paused data keeps the row and the error shows", async () => {
    pausedStatus();
    const { client } = renderWithClient(<App />);
    const rows = await overviewRows();
    await within(rows).findByText("Paused: no players connected");
    server.use(http.get(endpoints.status.route, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    await act(() =>
      client.refetchQueries({ predicate: (q) => q.queryKey.at(-1) === "status" }).catch(() => undefined),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(within(rows).getByText("Paused: no players connected")).toBeInTheDocument();
    expect(screen.queryByText(PAUSED_BANNER)).not.toBeInTheDocument();
  });

  // FINDING: serverHealth checks stale (and slow tick) before gamePaused, and the banner is
  // off on the Overview, so a stale-and-paused or slow-and-paused server never says
  // "paused" anywhere on the Overview. Every other page shows the paused banner.
  it.each([
    ["stale", { ...statusStale, data: { ...statusStale.data, gamePaused: true } }],
    ["slow tick", { ...statusSlow, data: { ...statusSlow.data, gamePaused: true } }],
  ])("%s AND paused: 'paused' is shown somewhere on the Overview", async (_name, body) => {
    pausedStatus(body);
    renderWithClient(<App />);
    const rows = await overviewRows();
    // The tick left the Server row (it's in the Health card), so slow-and-paused now says
    // "Paused" in the row itself; stale still wins there, with "· game paused" appended.
    await within(rows).findByText(/Showing last known data|Paused: no players connected/);
    expect(screen.queryAllByText(/paused/i).length).toBeGreaterThan(0);
  });
});

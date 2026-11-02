import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { sessionAnonymous } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { ADS_MARKER_CONTENT, ADS_MARKER_NAME } from "./config";

// Where the slots go (ADR-0021 amendment 3, build step 4, the placements in config.ts): with ads on and every unit
// set, one slot on Overview, Power, Factory and Planner, and none anywhere else (Decision 6: never on login, error,
// pairing, account or settings screens). The shipped config's units are placeholders, so this mocks them.
vi.mock("./config", async (original) => ({
  ...(await original<typeof import("./config")>()),
  AD_UNITS: { overview: "1000000001", power: "1000000002", factory: "1000000003", planner: "1000000004" },
}));

function adsOnMarker() {
  const meta = document.createElement("meta");
  meta.name = ADS_MARKER_NAME;
  meta.content = ADS_MARKER_CONTENT;
  document.head.append(meta);
}

afterEach(() => {
  document.head.querySelectorAll(`meta[name="${ADS_MARKER_NAME}"]`).forEach((el) => el.remove());
  delete window.adsbygoogle;
});

const slots = () => document.querySelectorAll("[data-ad-placement]");

describe("ad slot placements, ads on", () => {
  it.each([
    ["/app", "overview", "Overview"],
    ["/app/power", "power", "Power"],
    ["/app/factory", "factory", "Factory"],
    ["/app/planner", "planner", "Production planner"],
  ])("%s has one slot, below the page's panels", async (path, placement, region) => {
    adsOnMarker();
    window.history.pushState(null, "", path);
    renderWithClient(<App />);
    await screen.findByRole("region", { name: region }, { timeout: 5_000 });
    const slot = await screen.findByRole("region", { name: "Advertisements" }, { timeout: 5_000 });
    expect(slots()).toHaveLength(1);
    expect(slot).toHaveAttribute("data-ad-placement", placement);
    // After every panel of game data in the page, never inside one.
    expect(slot.parentElement!.closest("section, [role=region], dialog, [role=complementary]")).toBeNull();
    const regions = [...document.querySelectorAll("[role=region], section")].filter((el) => el !== slot);
    for (const panel of regions) expect(panel.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING, panel.getAttribute("aria-label") ?? "").toBeTruthy();
  });

  it.each([
    ["/app/settings", "Server settings"],
    ["/app/map", "Factory map"],
  ])("%s has none", async (path, region) => {
    adsOnMarker();
    window.history.pushState(null, "", path);
    renderWithClient(<App />);
    await screen.findByRole("region", { name: region }, { timeout: 5_000 });
    expect(slots()).toHaveLength(0);
  });

  it("the sign-in screen has none, and the landing page has none", async () => {
    adsOnMarker();
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    window.history.pushState(null, "", "/app");
    const { unmount } = renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(slots()).toHaveLength(0);
    unmount();
    window.history.pushState(null, "", "/");
    renderWithClient(<App />);
    await screen.findByRole("link", { name: "Try the live demo" });
    expect(slots()).toHaveLength(0);
  });

  it("with ads off there is no slot and no consent link, even with every unit set", async () => {
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" }, { timeout: 5_000 });
    await screen.findByRole("region", { name: "Server status" });
    expect(slots()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Privacy and cookie settings" })).not.toBeInTheDocument();
    expect(window.adsbygoogle).toBeUndefined();
  });
});

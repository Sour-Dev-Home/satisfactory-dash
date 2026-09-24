import { fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversSingle, statusPaused } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

describe("App", () => {
  it("signs in, selects the only server and shows its status banners and panel", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusPaused)));
    renderWithClient(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Satis Manager");
    expect(await screen.findByText(serversSingle.servers[0].displayName)).toBeInTheDocument();
    expect(await screen.findByText("Paused: no players connected, values are frozen.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Server status" })).toHaveTextContent("ExampleSession");
  });
});

describe("App routing (ADR-0016 item 4, ADR-0021)", () => {
  it("sends / to /app and keeps the query string", async () => {
    window.history.pushState(null, "", "/?scenario=outage");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" });
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?scenario=outage");
  });

  it("sends an unknown path inside the app back to the Overview", async () => {
    window.history.pushState(null, "", "/app/no-such-page");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" });
    expect(window.location.pathname).toBe("/app");
  });

  it("opens each tab's page and marks the current tab", async () => {
    renderWithClient(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(nav).getByRole("link", { name: "Power" }));
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/power");
    expect(within(nav).getByRole("link", { name: "Power" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(nav).getByRole("link", { name: "Factory" }));
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("region", { name: "Server settings" })).toBeInTheDocument();
  });

  it("opens a section's page from its Overview row", async () => {
    renderWithClient(<App />);
    const rows = await screen.findByRole("list", { name: "Sections" });
    fireEvent.click(await within(rows).findByRole("link", { name: /Power/ }));
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/power");
  });
});

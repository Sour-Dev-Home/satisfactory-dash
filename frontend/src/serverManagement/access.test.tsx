import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import { serversMemberCannotManage, serversSingle } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

// ADR-0030: the Servers tab is for the operator only. Hiding it is UX; the backend enforces.

const listServers = (body: ServerListResponse) => server.use(http.get(endpoints.servers.route, () => HttpResponse.json(body)));

describe("the Servers tab", () => {
  it("shows for the operator and opens server management", async () => {
    listServers({ ...serversSingle, canManageServers: true });
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Servers" }));
    expect(await screen.findByRole("list", { name: "Game servers" })).toBeInTheDocument();
  });

  it.each([
    ["a member", serversMemberCannotManage],
    ["an older backend without the flag", serversSingle],
  ])("is hidden for %s, and /app/servers goes back to the app", async (_who, list) => {
    listServers(list);
    window.history.pushState(null, "", "/app/servers");
    renderWithClient(<App />);
    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Servers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Game servers" })).not.toBeInTheDocument();
  });

  it("drops the tab and route, and redirects away, if canManageServers turns false while mounted on it", async () => {
    let manage = true;
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json({ ...serversSingle, canManageServers: manage })));
    window.history.pushState(null, "", "/app/servers");
    const { client } = renderWithClient(<App />);
    await screen.findByRole("list", { name: "Game servers" });
    expect(screen.getByRole("link", { name: "Servers" })).toBeInTheDocument();

    manage = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true });
    });

    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Servers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Game servers" })).not.toBeInTheDocument();
  });
});

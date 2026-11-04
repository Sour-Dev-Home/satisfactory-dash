import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { bottlenecksEmpty, factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryPanel } from "./FactoryPanel";
import { FactoryView } from "./FactoryView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderPage() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <BrowserRouter>
        <FactoryView />
      </BrowserRouter>
    </ServerContext>,
  );
}

// The page's fragments (#machines, #history, #bottlenecks) keep working for links after the in-page nav went (ADR-0064).
describe("the Factory page's deep links", () => {
  it("a #bottlenecks link opens the bottleneck card's full list and focuses it", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, "", "/app/factory#bottlenecks");
    renderPage();
    await waitFor(() => expect(document.getElementById("bottlenecks")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Full list of bottlenecks" })).toHaveAttribute("aria-expanded", "true");
    expect(scroll).toHaveBeenCalled();
  });

  it("no in-page nav, and no button when there are no bottlenecks", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json({ ...bottlenecksEmpty, data: { ...bottlenecksEmpty.data, notes: [], beltData: "present" } })));
    window.history.pushState(null, "", "/app/factory");
    renderPage();
    expect(await screen.findByRole("heading", { name: "No bottlenecks", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full list of bottlenecks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Factory sections" })).not.toBeInTheDocument();
  });

  it("keeps the hash while typing a search after a #history jump, and never steals focus back", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/app/factory#history");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Production history" })).toHaveFocus());

    const box = screen.getByRole("searchbox", { name: "Search machines" });
    box.focus();
    fireEvent.change(box, { target: { value: "smelter" } });
    expect(box).toHaveFocus();
    expect(window.location.hash).toBe("#history");
    expect(window.location.search).toBe("?q=smelter");
  });

  it("a #machines deep link on load focuses the Factory heading", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, "", "/app/factory?q=a#machines");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Factory", level: 3 })).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
  });

  it("a #history deep link does not move focus to the machines heading", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/app/factory#history");
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Production history" })).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Factory", level: 3 })).not.toHaveFocus();
  });

  it("FactoryPanel works standalone, without a router", () => {
    const { container } = render(<FactoryPanel snapshot={factoryMixed} />);
    expect(container.querySelector("#machines")).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search machines" })).toBeInTheDocument();
    expect(container.querySelector("[style]")).toBeNull();
  });
});

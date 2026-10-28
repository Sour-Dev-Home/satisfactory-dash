import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
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

const nav = () => screen.getByRole("navigation", { name: "Factory sections" });

describe("the in-page nav with the search box and deep links (ADR-0062 F.4)", () => {
  it("keeps the hash while typing a search after a jump, carries the new ?q= in the links, and never steals focus back", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/app/factory");
    renderPage();
    await screen.findByRole("navigation", { name: "Factory sections" });
    fireEvent.click(within(nav()).getByRole("link", { name: "History" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Production history" })).toHaveFocus());

    const box = screen.getByRole("searchbox", { name: "Search machines" });
    box.focus();
    fireEvent.change(box, { target: { value: "smelter" } });
    expect(box).toHaveFocus();
    expect(window.location.hash).toBe("#history");
    expect(window.location.search).toBe("?q=smelter");
    expect(within(nav()).getByRole("link", { name: "Machines" })).toHaveAttribute("href", "/app/factory?q=smelter#machines");
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

  it("FactoryPanel works standalone, without a router or a nav", () => {
    const { container } = render(<FactoryPanel snapshot={factoryMixed} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(container.querySelector("#machines")).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search machines" })).toBeInTheDocument();
    expect(container.querySelector("[style]")).toBeNull();
  });
});

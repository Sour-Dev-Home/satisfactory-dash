import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HealthCard } from "./HealthCard";
import { StationTiles, type OverviewSection } from "./StationTiles";

const healthy: OverviewSection[] = [
  { name: "Server", station: "server", state: { health: "ok", summary: "My save · 2 / 4 players" } },
  { name: "Power", station: "power", to: "/app/power", state: { health: "ok", summary: "1 circuit · 4,396 MW of 6,150 MW capacity" } },
  { name: "Factory", station: "factory", to: "/app/factory", state: { health: "ok", summary: "8 machines · 1 backed up" } },
];

function renderTiles(sections: OverviewSection[]) {
  return render(
    <MemoryRouter>
      <StationTiles sections={sections} />
    </MemoryRouter>,
  );
}

const tiles = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem");

describe("StationTiles", () => {
  it("draws a station tile per section, each with its icon and its one-line detail", () => {
    renderTiles(healthy);
    expect(tiles()).toHaveLength(3);
    expect(tiles().map((t) => t.querySelector("svg[data-station]")?.getAttribute("data-station"))).toEqual(["server", "power", "factory"]);
    expect(tiles()[0]).toHaveTextContent("My save · 2 / 4 players");
    expect(tiles()[1]).toHaveTextContent("1 circuit · 4,396 MW of 6,150 MW capacity");
  });

  it("stays silent while everything is healthy: no status word in any tile", () => {
    renderTiles(healthy);
    const list = screen.getByRole("list", { name: "Sections" });
    expect(list).not.toHaveTextContent("Operational");
    expect(list.querySelectorAll("[data-word]")).toHaveLength(0);
  });

  it.each([
    ["degraded", "Degraded", "text-warn"],
    ["outage", "Outage", "text-bad"],
    ["paused", "Paused", "text-info"],
  ] as const)("shows the word only on a %s tile, in its colour", (health, word, colour) => {
    renderTiles([healthy[0], { ...healthy[1], state: { health, summary: "1 circuit is at risk" } }, healthy[2]]);
    const words = screen.getByRole("list", { name: "Sections" }).querySelectorAll("[data-word]");
    expect(words).toHaveLength(1);
    expect(within(tiles()[1]).getByText(word)).toHaveClass(colour);
  });

  it("shows a loading or failed section's word, since it isn't known to be healthy", () => {
    renderTiles([{ ...healthy[0], state: "pending" }, { ...healthy[1], state: "error" }, healthy[2]]);
    expect(tiles()[0]).toHaveTextContent("Checking…Loading…");
    expect(tiles()[1]).toHaveTextContent("UnavailableCouldn't load this section");
    expect(tiles()[2].querySelector("[data-word]")).toBeNull();
  });

  it("puts a healthy factory's backed-up count in the warn colour", () => {
    renderTiles(healthy);
    expect(within(tiles()[2]).getByText("1 backed up")).toHaveClass("text-warn");
  });

  it.each(["8 machines · 0 backed up", "No machines yet"])("leaves %j uncoloured", (summary) => {
    renderTiles([{ ...healthy[2], state: { health: "ok", summary } }]);
    expect(tiles()[0].querySelector(".text-warn")).toBeNull();
    expect(tiles()[0]).toHaveTextContent(summary);
  });

  it("doesn't colour the count again when the factory is already a warning", () => {
    renderTiles([{ ...healthy[2], state: { health: "degraded", summary: "3 of 8 machines backed up" } }]);
    expect(within(tiles()[0]).getByText("3 of 8 machines backed up")).toHaveClass("text-muted");
  });

  it("links each tile that has a page, and leaves one without a page as plain text", () => {
    renderTiles(healthy);
    expect(within(tiles()[0]).queryByRole("link")).toBeNull();
    expect(within(tiles()[1]).getByRole("link")).toHaveAttribute("href", "/app/power");
    expect(within(tiles()[2]).getByRole("link")).toHaveAttribute("href", "/app/factory");
  });

  it("renders nothing for no sections", () => {
    renderTiles([]);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("HealthCard: one health statement (#442)", () => {
  it("says the overall state once, in the display face at a large size, with the tiles silent", () => {
    render(
      <MemoryRouter>
        <HealthCard overall={{ health: "ok", headline: "All systems operational" }} sections={healthy} />
      </MemoryRouter>,
    );
    const card = screen.getByRole("region", { name: "Health" });
    expect(within(card).getAllByText("Operational")).toHaveLength(1);
    const statement = card.querySelector("[data-statement]")!;
    expect(statement).toHaveTextContent("Operational");
    expect(statement).toHaveClass("font-display", "text-4xl", "text-ok");
    expect(within(card).getByRole("list", { name: "Sections" })).toBeInTheDocument();
  });

  it("names the area at fault in its tile while the statement gives the overall state", () => {
    render(
      <MemoryRouter>
        <HealthCard
          overall={{ health: "degraded", headline: "Running with warnings" }}
          sections={[healthy[0], healthy[1], { ...healthy[2], state: { health: "degraded", summary: "3 of 8 machines backed up" } }]}
        />
      </MemoryRouter>,
    );
    const card = screen.getByRole("region", { name: "Health" });
    expect(card.querySelector("[data-statement]")).toHaveTextContent("Degraded");
    expect(within(screen.getByRole("list", { name: "Sections" })).getAllByText("Degraded")).toHaveLength(1);
  });

  it("shows how old the status is beside the tick", () => {
    const observedAt = new Date(Date.now() - 8_000).toISOString();
    render(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 29.6, health: "healthy" }} age={{ observedAt, late: false }} />);
    expect(screen.getByRole("region", { name: "Health" })).toHaveTextContent(/Updated \d+ s ago/);
  });

  it("gives the card its corner rivets, hidden from screen readers", () => {
    render(<HealthCard overall={{ health: "ok", headline: "x" }} />);
    const rivets = screen.getByRole("region").querySelectorAll("[data-rivet]");
    expect(rivets).toHaveLength(4);
    for (const rivet of rivets) expect(rivet).toHaveAttribute("aria-hidden", "true");
  });
});

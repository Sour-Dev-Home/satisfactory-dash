import { render, screen, within } from "@testing-library/react";
import type { Status } from "@satisfactory-dash/shared";
import {
  playersAvailable,
  playersEmpty,
  playersUnavailable,
  statusNoGame,
  statusRunning,
  statusPaused,
} from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { MAX_FIGURES, MAX_NAMES } from "./players";
import { PlayersCard } from "./PlayersCard";

const running = (patch: Partial<Status>) => ({ status: { ...statusRunning.data, ...patch } });

function figures(container: HTMLElement) {
  return {
    connected: container.querySelectorAll('svg[data-slot="connected"]').length,
    free: container.querySelectorAll('svg[data-slot="free"]').length,
  };
}

describe("PlayersCard", () => {
  it("draws a filled figure per connected player and an outline per free slot", () => {
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 2, playerLimit: 4 })} />);
    expect(figures(container)).toEqual({ connected: 2, free: 2 });
    expect(screen.getByText("2 of 4 players connected")).toBeInTheDocument();
  });

  it("hides the figures from screen readers: the sentence is the content", () => {
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 1, playerLimit: 4 })} />);
    for (const svg of container.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it(`shows at most ${MAX_FIGURES} figures, then "+N" for the other slots`, () => {
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 10, playerLimit: 12 })} />);
    expect(figures(container)).toEqual({ connected: MAX_FIGURES, free: 0 });
    expect(screen.getByText("+4")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("10 of 12 players connected")).toBeInTheDocument();
  });

  it("uses no style attributes (the CSP forbids inline styles)", () => {
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 3, playerLimit: 12 })} />);
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("says 1 player in the singular", () => {
    render(<PlayersCard state={running({ connectedPlayers: 0, playerLimit: 1 })} />);
    expect(screen.getByText("0 of 1 player connected")).toBeInTheDocument();
  });

  it("is neutral with no game running: no figures, no alarm", () => {
    const { container } = render(<PlayersCard state={{ status: statusNoGame.data }} />);
    expect(screen.getByText("No game running.")).toHaveClass("text-muted");
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("says when the game is paused, in the same neutral tone", () => {
    render(<PlayersCard state={{ status: statusPaused.data }} />);
    expect(screen.getByText("The game is paused.")).toHaveClass("text-muted");
  });

  it("never shows more filled figures than slots when the server reports more players than the limit", () => {
    // A buggy or stale server can report connectedPlayers > playerLimit; the card must not
    // render a negative "free" count or more filled figures than slots.
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 10, playerLimit: 4 })} />);
    expect(figures(container)).toEqual({ connected: 4, free: 0 });
    // The sentence still reports the server's raw numbers, even though they don't reconcile.
    expect(screen.getByText("10 of 4 players connected")).toBeInTheDocument();
  });

  it("says a running game with no player slots has none, rather than that no game runs", () => {
    // The schema allows playerLimit 0 with a running game (no cross-field rule), though a
    // real dedicated server shouldn't report it (found by the fresh-eyes pass on #132).
    const { container } = render(<PlayersCard state={running({ isGameRunning: true, playerLimit: 0, connectedPlayers: 0 })} />);
    expect(screen.getByText("The server allows no players.")).toHaveClass("text-muted");
    expect(screen.queryByText("No game running.")).not.toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("shows loading and error states without inventing a count", () => {
    const { rerender } = render(<PlayersCard state="pending" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<PlayersCard state="error" />);
    expect(screen.getByText("Couldn't load the player count.")).toBeInTheDocument();
    expect(screen.queryByText(/players connected/)).not.toBeInTheDocument();
  });
});

describe("PlayersCard names (ADR-0029)", () => {
  const online = playersAvailable.players.filter((p) => p.online).map((p) => p.name);
  const offline = playersAvailable.players.filter((p) => !p.online).map((p) => p.name);

  it("lists who is online, as text, under the count", () => {
    render(<PlayersCard state={running({ connectedPlayers: online.length })} roster={playersAvailable} />);
    const list = screen.getByRole("list", { name: "Players online" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(online);
    for (const name of offline) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });

  it("keeps just the counts when the server has no player list", () => {
    render(<PlayersCard state={running({ connectedPlayers: 2 })} roster={playersUnavailable} />);
    expect(screen.getByText("2 of 4 players connected")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Players online" })).not.toBeInTheDocument();
  });

  it("keeps just the counts while the list loads or if it fails (no roster)", () => {
    render(<PlayersCard state={running({ connectedPlayers: 2 })} />);
    expect(screen.queryByRole("list", { name: "Players online" })).not.toBeInTheDocument();
  });

  it("shows no list when nobody is online", () => {
    render(<PlayersCard state={running({ connectedPlayers: 0 })} roster={playersEmpty} />);
    expect(screen.queryByRole("list", { name: "Players online" })).not.toBeInTheDocument();
  });

  it("shows no names when no game is running, even with a roster", () => {
    render(<PlayersCard state={{ status: statusNoGame.data }} roster={playersAvailable} />);
    expect(screen.queryByRole("list", { name: "Players online" })).not.toBeInTheDocument();
  });

  it(`lists at most ${MAX_NAMES} names, then "and N more"`, () => {
    const many = { available: true, players: Array.from({ length: MAX_NAMES + 3 }, (_, i) => ({ name: `P${i}`, online: true })) };
    render(<PlayersCard state={running({ connectedPlayers: MAX_NAMES + 3, playerLimit: 16 })} roster={many} />);
    expect(within(screen.getByRole("list", { name: "Players online" })).getAllByRole("listitem")).toHaveLength(MAX_NAMES);
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  it("renders a name as text, never as HTML, and allows duplicate names", () => {
    const roster = { available: true, players: [{ name: "<b>X</b>", online: true }, { name: "<b>X</b>", online: true }] };
    const { container } = render(<PlayersCard state={running({ connectedPlayers: 2 })} roster={roster} />);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getAllByText("<b>X</b>")).toHaveLength(2);
  });
});

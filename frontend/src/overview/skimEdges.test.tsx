import { render, screen } from "@testing-library/react";
import { statusRunning } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { headlineSaysMore, overallHealth, serverHealth } from "./health";
import { HealthCard } from "./cards/HealthCard";
import { PlayersCard } from "./cards/PlayersCard";
import { playersText } from "./cards/players";

describe("headlineSaysMore (ADR-0064)", () => {
  it.each([
    ["ok", "All systems operational", false],
    ["paused", "Game paused", false],
    ["degraded", "Running with warnings", false],
    ["unavailable", "Some data is unavailable", false],
    ["outage", "Power outage", false],
    ["degraded", "Server tick is slow · Factory backed up", true],
    ["degraded", "Server tick is slow", true],
    ["pending", "Checking…", true],
    ["updating", "Back in a moment", true],
    ["ok", "", false],
    ["ok", "Power outage", true],
  ])("%s / %j -> %s", (health, headline, expected) => {
    expect(headlineSaysMore({ health, headline })).toBe(expected);
  });

  it("agrees with overallHealth for every state it produces", () => {
    const ok = { health: "ok", summary: "" } as const;
    const slow = { health: "degraded", summary: "", cause: "Server tick is slow" } as const;
    expect(headlineSaysMore(overallHealth([ok]))).toBe(false);
    expect(headlineSaysMore(overallHealth([ok, "error"]))).toBe(false);
    expect(headlineSaysMore(overallHealth([ok, "pending"]))).toBe(true);
    expect(headlineSaysMore(overallHealth([ok, "updating"]))).toBe(true);
    expect(headlineSaysMore(overallHealth([ok, slow]))).toBe(true);
  });
});

describe("serverHealth summary edges (ADR-0064)", () => {
  const withData = (patch: Partial<typeof statusRunning.data>) => ({ ...statusRunning, data: { ...statusRunning.data, ...patch } });

  it("says the save and its play time", () => {
    expect(serverHealth(withData({ sessionName: "Save", totalGameDurationSeconds: 95_400 })).summary).toBe("Save · 1 d 2 h 30 m played");
  });

  it("handles no play time yet and a huge one", () => {
    expect(serverHealth(withData({ sessionName: "Save", totalGameDurationSeconds: 0 })).summary).toBe("Save · 0 s played");
    expect(serverHealth(withData({ sessionName: "Save", totalGameDurationSeconds: 86_400 * 400 })).summary).toBe("Save · 400 d 0 h 0 m played");
  });

  it("leaves no dangling separator for a blank session name", () => {
    expect(serverHealth(withData({ sessionName: "  ", totalGameDurationSeconds: 3600 })).summary).toBe("1 h 0 m played");
  });
});

describe("playersText edges", () => {
  it("handles connected above the limit and a single slot", () => {
    expect(playersText({ ...statusRunning.data, connectedPlayers: 5, playerLimit: 4 })).toBe("5 of 4 players connected");
    expect(playersText({ ...statusRunning.data, connectedPlayers: 0, playerLimit: 1 })).toBe("No players connected (1 slot)");
  });
});

describe("cards at the edges (ADR-0064)", () => {
  it("HealthCard keeps the slow tick line while the warning is hidden", () => {
    render(<HealthCard overall={{ health: "degraded", headline: "Server tick is slow" }} hidden tick={{ rate: 8, health: "slow" }} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("Server tick is slow");
    expect(screen.getByRole("region", { name: "Health" })).toHaveTextContent("Tick 8.0/s · Slow");
  });

  it("PlayersCard with nobody on, paused, and an available roster with none online, shows the line and the pause", () => {
    const { container } = render(
      <PlayersCard
        state={{ status: { ...statusRunning.data, connectedPlayers: 0, playerLimit: 4, gamePaused: true } }}
        roster={{ available: true, players: [{ name: "Gone", online: false }] } as never}
      />,
    );
    expect(screen.getByText("No players connected (4 slots)")).toBeInTheDocument();
    expect(screen.getByText("The game is paused.")).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
  });
});

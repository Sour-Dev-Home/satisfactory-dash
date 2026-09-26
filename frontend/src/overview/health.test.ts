import { describe, expect, it } from "vitest";
import {
  factoryEmpty,
  factoryMixed,
  powerAtRisk,
  powerEmpty,
  powerOk,
  powerOutage,
  powerStale,
  statusNoGame,
  statusPaused,
  statusRunning,
  statusSlow,
  statusStale,
} from "@satisfactory-dash/shared/fixtures";
import type { FactoryResponse } from "@satisfactory-dash/shared";
import { canDismiss, factoryHealth, overallHealth, powerHealth, serverHealth, tickState, warningKey } from "./health";

function factoryWith(total: number, backedUp: number): FactoryResponse {
  const building = factoryMixed.data.buildings[0];
  const buildings = Array.from({ length: total }, (_, i) => ({ ...building, id: `b${i}`, isBackedUp: i < backedUp }));
  return { ...factoryMixed, data: { buildings, backedUpCount: backedUp } };
}

describe("serverHealth", () => {
  it("is ok for a running game, with players and save in the summary", () => {
    const h = serverHealth(statusRunning);
    expect(h.health).toBe("ok");
    expect(h.summary).toContain(statusRunning.data.sessionName);
  });

  it.each([
    ["no save loaded", statusNoGame, "degraded", "No save loaded"],
    ["stale data", statusStale, "degraded", "Showing last known data"],
    ["a paused game", statusPaused, "paused", "Paused: no players connected"],
  ] as const)("flags %s", (_, snapshot, health, summary) => {
    expect(serverHealth(snapshot)).toEqual({ health, summary });
  });

  // The owner's call: the tick lives only in the Health card, never in this row.
  it("says nothing about a slow tick", () => {
    expect(serverHealth(statusSlow).health).toBe("ok");
    expect(serverHealth(statusSlow).summary).not.toMatch(/tick/i);
  });

  // The Overview has no paused banner, so a worse state must not hide that the game is paused.
  it("still says paused when stale wins", () => {
    const snapshot = { ...statusStale, data: { ...statusStale.data, gamePaused: true } };
    expect(serverHealth(snapshot)).toEqual({ health: "degraded", summary: "Showing last known data · game paused" });
  });
});

describe("tickState", () => {
  it("is a warning for the backend's slow tick, and ok otherwise", () => {
    expect(tickState(statusSlow)).toEqual({ health: "degraded", summary: "Server tick is slow" });
    expect(tickState(statusRunning).health).toBe("ok");
  });

  it("doesn't judge the tick with no save loaded", () => {
    expect(tickState({ ...statusNoGame, data: { ...statusNoGame.data, tickHealth: "slow" } }).health).toBe("ok");
  });
});

describe("powerHealth", () => {
  it("is an outage when a fuse has tripped", () => {
    expect(powerHealth(powerOutage)).toEqual({ health: "outage", summary: "1 circuit has a tripped fuse" });
  });

  it("is degraded when a circuit is at risk", () => {
    expect(powerHealth(powerAtRisk)).toEqual({ health: "degraded", summary: "1 circuit is at risk" });
  });

  it("is ok otherwise, with production and capacity", () => {
    const h = powerHealth(powerOk);
    expect(h.health).toBe("ok");
    expect(h.summary).toMatch(/^1 circuit · .+ MW of .+ MW capacity$/);
  });

  it("is ok with no circuits yet", () => {
    expect(powerHealth(powerEmpty)).toEqual({ health: "ok", summary: "No power circuits yet" });
  });

  it("is degraded when an otherwise healthy snapshot is stale", () => {
    expect(powerHealth({ ...powerStale, data: powerOk.data })).toEqual({
      health: "degraded",
      summary: "Showing last known power data",
    });
  });

  it("keeps an outage an outage even when stale", () => {
    expect(powerHealth({ ...powerOutage, stale: true }).health).toBe("outage");
  });
});

describe("factoryHealth", () => {
  it("is ok at or below a quarter of machines backed up", () => {
    expect(factoryHealth(factoryWith(8, 2))).toEqual({ health: "ok", summary: "8 machines · 2 backed up" });
  });

  it("is degraded above a quarter of machines backed up", () => {
    expect(factoryHealth(factoryWith(8, 3))).toEqual({ health: "degraded", summary: "3 of 8 machines backed up" });
  });

  it("is ok with no machines", () => {
    expect(factoryHealth(factoryEmpty)).toEqual({ health: "ok", summary: "No machines yet" });
  });

  it("uses the singular for one machine", () => {
    expect(factoryHealth(factoryWith(1, 0)).summary).toBe("1 machine · 0 backed up");
  });

  it("is degraded when an otherwise healthy snapshot is stale", () => {
    expect(factoryHealth({ ...factoryWith(4, 0), stale: true })).toEqual({
      health: "degraded",
      summary: "Showing last known factory data",
    });
  });
});

describe("warningKey", () => {
  const s = (name: string, health: "ok" | "degraded" | "paused", summary = "") => ({
    name,
    state: { health, summary },
  });

  it("names each section that isn't ok, with its level, in a stable order", () => {
    expect(warningKey([s("Server", "paused"), s("Power", "ok"), s("Factory", "degraded")])).toBe(
      "Factory:degraded|Server:paused",
    );
  });

  it("ignores the summary, so a count changing inside a warning doesn't count as a change", () => {
    expect(warningKey([s("Factory", "degraded", "2 of 5 machines backed up")])).toBe(
      warningKey([s("Factory", "degraded", "3 of 5 machines backed up")]),
    );
  });

  it("changes when another section starts warning", () => {
    expect(warningKey([s("Factory", "degraded"), s("Power", "degraded")])).not.toBe(
      warningKey([s("Factory", "degraded")]),
    );
  });

  it("skips loading and failed sections (a failure is never dismissible anyway)", () => {
    expect(warningKey([{ name: "Power", state: "pending" }, { name: "Factory", state: "error" }])).toBe("");
  });
});

describe("canDismiss", () => {
  it("allows only warnings and a paused game, never an outage or missing data", () => {
    expect(["ok", "pending", "paused", "degraded", "unavailable", "outage"].filter((h) => canDismiss(h as never))).toEqual([
      "paused",
      "degraded",
    ]);
  });
});

describe("overallHealth", () => {
  const ok = { health: "ok", summary: "" } as const;

  it("is operational when every section is ok", () => {
    expect(overallHealth([ok, ok, ok])).toEqual({ health: "ok", headline: "All systems operational" });
  });

  it("takes the worst section", () => {
    expect(overallHealth([ok, { health: "paused", summary: "" }, { health: "degraded", summary: "" }])).toEqual({
      health: "degraded",
      headline: "Running with warnings",
    });
    expect(overallHealth(["error", { health: "outage", summary: "" }])).toEqual({
      health: "outage",
      headline: "Power outage",
    });
  });

  it("counts a section that failed to load as unavailable", () => {
    expect(overallHealth([ok, "error"])).toEqual({ health: "unavailable", headline: "Some data is unavailable" });
  });

  it("says the game is paused when that's the only thing going on", () => {
    expect(overallHealth([ok, { health: "paused", summary: "" }])).toEqual({ health: "paused", headline: "Game paused" });
  });

  it("is still checking while any section is loading and nothing is worse yet", () => {
    expect(overallHealth([ok, "pending"])).toEqual({ health: "pending", headline: "Checking…" });
    expect(overallHealth(["pending", { health: "outage", summary: "" }]).health).toBe("outage");
  });
});

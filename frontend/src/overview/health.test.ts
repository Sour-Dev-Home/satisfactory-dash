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
    ["no save loaded", statusNoGame, { health: "degraded", summary: "No save loaded", cause: "No save loaded" }],
    ["stale data", statusStale, { health: "degraded", summary: "Showing last known data", cause: "Server data is stale" }],
    ["a paused game", statusPaused, { health: "paused", summary: "Paused: no players connected" }],
  ] as const)("flags %s", (_, snapshot, expected) => {
    expect(serverHealth(snapshot)).toEqual(expected);
  });

  // The owner's call: the tick lives only in the Health card, never in this row.
  it("says nothing about a slow tick", () => {
    expect(serverHealth(statusSlow).health).toBe("ok");
    expect(serverHealth(statusSlow).summary).not.toMatch(/tick/i);
  });

  // The Overview has no paused banner, so a worse state must not hide that the game is paused.
  it("still says paused when stale wins", () => {
    const snapshot = { ...statusStale, data: { ...statusStale.data, gamePaused: true } };
    expect(serverHealth(snapshot)).toEqual({
      health: "degraded",
      summary: "Showing last known data · game paused",
      cause: "Server data is stale",
    });
  });
});

describe("tickState", () => {
  it("is a warning for the backend's slow tick, and ok otherwise", () => {
    expect(tickState(statusSlow)).toEqual({ health: "degraded", summary: "Server tick is slow", cause: "Server tick is slow" });
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
    expect(powerHealth(powerAtRisk)).toEqual({ health: "degraded", summary: "1 circuit is at risk", cause: "Power at risk" });
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
      cause: "Power data is stale",
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
    expect(factoryHealth(factoryWith(8, 3))).toEqual({
      health: "degraded",
      summary: "3 of 8 machines backed up",
      cause: "Factory backed up",
    });
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
      cause: "Factory data is stale",
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

  // The owner's call (option A): the tick has no row, so a slow tick names the causes.
  describe("with a slow tick", () => {
    const tick = tickState(statusSlow);
    const factory = factoryHealth(factoryWith(8, 3));

    it("says so instead of the generic warning", () => {
      expect(overallHealth([ok, tick, ok])).toEqual({ health: "degraded", headline: "Server tick is slow" });
    });

    it("names the other warnings after it", () => {
      expect(overallHealth([ok, factory, tick]).headline).toBe("Server tick is slow · Factory backed up");
    });

    it("keeps the generic warning without a slow tick, and a worse state's own headline", () => {
      expect(overallHealth([ok, factory]).headline).toBe("Running with warnings");
      expect(overallHealth([tick, { health: "outage", summary: "" }]).headline).toBe("Power outage");
    });

    // A failed section outranks a warning, so it's a worse level (unavailable), not a tie: the
    // generic headline wins even though the tick's cause is sitting right there.
    it("falls back to the generic headline when a failed section outranks the tick", () => {
      expect(overallHealth([tick, "error"])).toEqual({ health: "unavailable", headline: "Some data is unavailable" });
    });

    // Paused (rank 1) never outranks a slow tick's degraded (rank 2), and it carries no cause of
    // its own, so it must neither win the banner nor blank out the tick's cause.
    it("still names the tick when a paused section is also present", () => {
      const paused = { health: "paused", summary: "Paused: no players connected" } as const;
      expect(overallHealth([paused, tick])).toEqual({ health: "degraded", headline: "Server tick is slow" });
    });

    // "pending" only holds back an all-clear (see overallHealth's doc comment); it must not mask
    // an already-known slow tick once another section is still loading.
    it("still names the tick while another section is pending", () => {
      expect(overallHealth([tick, "pending"])).toEqual({ health: "degraded", headline: "Server tick is slow" });
    });

    // Two non-tick sections sharing a cause text is reachable only by a bug elsewhere (today's
    // causes are all distinct strings), but overallHealth itself has no dedup for that case:
    // document that a repeat prints twice rather than silently disappearing.
    it("doesn't dedup a repeated non-tick cause", () => {
      const dup = { health: "degraded", summary: "", cause: "Factory backed up" } as const;
      expect(overallHealth([tick, dup, dup]).headline).toBe(
        "Server tick is slow · Factory backed up · Factory backed up",
      );
    });

    // A cause that happens to equal SLOW_TICK's own text is a special case worth pinning down:
    // the "others" filter strips every match of that exact string, not just the one already
    // prepended, so this collapses to one occurrence instead of the two you'd expect from a
    // naive "no dedup" model.
    it("swallows a non-tick cause that happens to collide with the tick's own text", () => {
      const collision = { health: "degraded", summary: "", cause: "Server tick is slow" } as const;
      expect(overallHealth([tick, collision]).headline).toBe("Server tick is slow");
    });
  });

  // The dismissal key must survive this change: it's keyed on health only, so a cause never
  // makes an already-dismissed warning reappear, and never masks a real level change either.
  it("warningKey ignores cause the same way it ignores summary", () => {
    const withCause = [{ name: "Tick", state: { health: "degraded" as const, summary: "x", cause: "Server tick is slow" } }];
    const withoutCause = [{ name: "Tick", state: { health: "degraded" as const, summary: "x" } }];
    expect(warningKey(withCause)).toBe(warningKey(withoutCause));
  });
});

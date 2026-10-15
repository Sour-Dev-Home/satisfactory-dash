import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@satisfactory-dash/game-adapter";
import { SnapshotRequestSchema } from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, playersAvailable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import type { AgentLogger, LogFields } from "./logger.js";
import { MAP_LIVE_AGENT_MAX_BYTES, MAP_LIVE_AGENT_MAX_ITEMS, Sampler, failureCode } from "./sampler.js";
import type { GameReader } from "./sampler.js";

const T0 = Date.parse("2026-09-26T12:00:00.000Z");
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const unreachable = () => new UpstreamError("connect ECONNREFUSED 127.0.0.1:7777 with token TOKEN-abc-123", { failureKind: "unreachable" });

function setup(overrides: Partial<GameReader> = {}, cadence = CADENCE) {
  const reader: GameReader = {
    readStatus: vi.fn(async () => ({ ...statusRunning.data })),
    readPower: vi.fn(async () => agentSnapshotRequestFull.power as AgentPower),
    readFactory: vi.fn(async () => agentSnapshotRequestFull.factory as AgentFactory),
    readPlayers: vi.fn(async () => playersAvailable),
    readAutoPause: vi.fn(async () => true),
    applyAutoPause: vi.fn(async () => undefined),
    ...overrides,
  };
  const events: { level: string; event: string; fields?: LogFields }[] = [];
  const logger: AgentLogger = {
    info: (event, fields) => events.push({ level: "info", event, fields }),
    warn: (event, fields) => events.push({ level: "warn", event, fields }),
    error: (event, fields) => events.push({ level: "error", event, fields }),
    addSecret: () => undefined,
  };
  let current = cadence;
  const sampler = new Sampler({ reader, cadence: () => current, logger });
  return { reader: reader as { [K in keyof GameReader]: ReturnType<typeof vi.fn> }, sampler, events, setCadence: (next: typeof CADENCE) => (current = next) };
}
const valid = (snapshot: unknown) => SnapshotRequestSchema.safeParse(snapshot).success;

describe("which parts a snapshot carries", () => {
  it("the first snapshot carries everything, including the auto-pause setting, and is accepted by the backend's schema", async () => {
    const { sampler } = setup();
    const snapshot = await sampler.sample(T0);
    expect(snapshot).toMatchObject({ reachable: true, paused: statusRunning.data.gamePaused, settings: { autoPause: true }, agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z" });
    expect(Object.keys(snapshot).sort()).toEqual(["agentVersion", "factory", "observedAt", "paused", "players", "power", "reachable", "settings", "status"]);
    expect(valid(snapshot)).toBe(true);
  });

  it("later ones carry the parts that are due by their OWN cadence: status and players each pass, power every 5 s, factory every 30 s, the setting each status cadence", async () => {
    const { sampler, reader } = setup();
    await sampler.sample(T0);
    const two = await sampler.sample(T0 + 2_000);
    expect(Object.keys(two).sort()).toEqual(["agentVersion", "observedAt", "paused", "players", "reachable", "status"]);
    const five = await sampler.sample(T0 + 5_000);
    expect(Object.keys(five).sort()).toEqual(["agentVersion", "observedAt", "paused", "players", "power", "reachable", "settings", "status"]);
    const thirty = await sampler.sample(T0 + 30_000);
    expect(thirty.factory).toBeDefined();
    expect(reader.readFactory).toHaveBeenCalledTimes(2);
    expect(reader.readPower).toHaveBeenCalledTimes(3);
    expect(reader.readAutoPause).toHaveBeenCalledTimes(3); // T0, T0+5s, T0+30s
  });

  it("a cadence the backend changes applies at once (the getter is read on every pass)", async () => {
    const { sampler, setCadence, reader } = setup();
    await sampler.sample(T0);
    setCadence({ statusSeconds: 10, powerSeconds: 60, factorySeconds: 300 });
    await sampler.sample(T0 + 10_000);
    await sampler.sample(T0 + 20_000);
    expect(reader.readPower).toHaveBeenCalledTimes(1);
    expect(reader.readAutoPause).toHaveBeenCalledTimes(3);
  });

  it("`paused` comes from the fresh status read", async () => {
    const { sampler } = setup({ readStatus: vi.fn(async () => ({ ...statusRunning.data, gamePaused: true })) });
    expect((await sampler.sample(T0)).paused).toBe(true);
  });
});

describe("an unreachable game", () => {
  it("sends `reachable: false`, `paused: null`, NO parts and NO settings, and reads nothing else", async () => {
    const { sampler, reader } = setup({ readStatus: vi.fn(async () => Promise.reject(unreachable())) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot).toEqual({ agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z", reachable: false, paused: null });
    expect(valid(snapshot)).toBe(true);
    for (const method of ["readPower", "readFactory", "readPlayers", "readAutoPause"] as const) expect(reader[method]).not.toHaveBeenCalled();
  });

  it("logs the failure ONCE as a code (never the message), and says when it recovered", async () => {
    let fail = true;
    const { sampler, events } = setup({ readStatus: vi.fn(async () => (fail ? Promise.reject(unreachable()) : { ...statusRunning.data })) });
    await sampler.sample(T0);
    await sampler.sample(T0 + 5_000);
    await sampler.sample(T0 + 10_000);
    expect(events).toEqual([{ level: "warn", event: "read_failed", fields: { part: "status", code: "upstream_unreachable" } }]);
    fail = false;
    await sampler.sample(T0 + 15_000);
    expect(events.at(-1)).toEqual({ level: "info", event: "read_recovered", fields: { part: "status" } });
    expect(JSON.stringify(events)).not.toContain("TOKEN-abc-123");
    expect(JSON.stringify(events)).not.toContain("127.0.0.1");
  });

  it("a bug in a read (not an UpstreamError) is `internal_error`, and the pass is still just unreachable", async () => {
    const { sampler, events } = setup({ readStatus: vi.fn(async () => Promise.reject(new TypeError("cannot read properties of undefined"))) });
    expect((await sampler.sample(T0)).reachable).toBe(false);
    expect(events[0]).toMatchObject({ fields: { code: "internal_error" } });
  });
});

describe("a part that fails while the game is reachable", () => {
  it("is left out, the other parts still go, and it is logged once as a code", async () => {
    const { sampler, events } = setup({ readFactory: vi.fn(async () => Promise.reject(new UpstreamError("bad shape ...player Alice...", { failureKind: "invalid_response" }))) });
    const first = await sampler.sample(T0);
    expect(first).not.toHaveProperty("factory");
    expect(first).toHaveProperty("power");
    expect(first).toHaveProperty("status");
    expect(valid(first)).toBe(true);
    await sampler.sample(T0 + 30_000);
    expect(events.filter((entry) => entry.event === "read_failed")).toEqual([{ level: "warn", event: "read_failed", fields: { part: "factory", code: "upstream_invalid_response" } }]);
    expect(JSON.stringify(events)).not.toContain("Alice");
  });
});

describe("settings.autoPause (architect: only when the game is reachable and the read worked)", () => {
  it("a failed read leaves `settings` out (never a stale or guessed value) and is logged once", async () => {
    let fail = true;
    const { sampler, events } = setup({ readAutoPause: vi.fn(async () => (fail ? Promise.reject(new UpstreamError("nope", { status: 403 })) : false)) });
    const first = await sampler.sample(T0);
    expect(first).not.toHaveProperty("settings");
    expect(valid(first)).toBe(true);
    await sampler.sample(T0 + 5_000);
    expect(events.filter((entry) => entry.fields?.part === "auto_pause")).toEqual([{ level: "warn", event: "read_failed", fields: { part: "auto_pause", code: "upstream_auth_rejected" } }]);
    fail = false;
    const later = await sampler.sample(T0 + 10_000);
    expect(later.settings).toEqual({ autoPause: false });
  });

  it("is sent whatever value it has, including false", async () => {
    const { sampler } = setup({ readAutoPause: vi.fn(async () => false) });
    expect((await sampler.sample(T0)).settings).toEqual({ autoPause: false });
  });
});

describe("the readings are conformed to the backend's bounds before they go", () => {
  it("a hostile reading still yields a snapshot the schema accepts, and the adjustment is logged as a count", async () => {
    const hostile = {
      buildings: [{ ...agentSnapshotRequestFull.factory.buildings[0]!, name: "x".repeat(500), production: [{ ...agentSnapshotRequestFull.factory.buildings[0]!.production[0]!, percent: Number.NaN }] }],
    } as AgentFactory;
    const { sampler, events } = setup({ readFactory: vi.fn(async () => hostile) });
    const snapshot = await sampler.sample(T0);
    expect(valid(snapshot)).toBe(true);
    expect(events).toContainEqual({ level: "warn", event: "readings_adjusted", fields: { entries: 1 } });
  });
});

describe("failureCode", () => {
  it("maps adapter failures to plain codes and everything else to internal_error", () => {
    expect(failureCode(new UpstreamError("x", { failureKind: "unreachable" }))).toBe("upstream_unreachable");
    expect(failureCode(new UpstreamError("x", { failureKind: "invalid_response" }))).toBe("upstream_invalid_response");
    expect(failureCode(new UpstreamError("x", { status: 401 }))).toBe("upstream_auth_rejected");
    expect(failureCode(new UpstreamError("x", { status: 403 }))).toBe("upstream_auth_rejected");
    expect(failureCode(new UpstreamError("x", { status: 500 }))).toBe("upstream_error");
    expect(failureCode(new Error("x"))).toBe("internal_error");
    expect(failureCode("string")).toBe("internal_error");
  });
});

describe("mapLive: trains and stations on the 30 s cadence (ADR-0038 step 5)", () => {
  const train = (i: number, name = `Train ${i}`) => ({ id: `t${i}`, name, x: i, y: -i, status: "Self-Driving" });
  const station = (i: number, name = `Station ${i}`) => ({ id: `s${i}`, name, x: -i, y: i });
  const live = (trains: ReturnType<typeof train>[], stations: ReturnType<typeof station>[], dropped = 0) => vi.fn(async () => ({ trains, stations, dropped }));
  const longName = "N".repeat(200);
  // 500 of each kind with 200-character ids and names: about 440 KB, within the item caps but over the byte cap.
  const longId = (prefix: string, i: number) => `${prefix}${i}`.padEnd(200, "0");
  const overByteCap = () => ({
    trains: Array.from({ length: 500 }, (_, i) => ({ ...train(i, longName), id: longId("t", i) })),
    stations: Array.from({ length: 500 }, (_, i) => ({ ...station(i, longName), id: longId("s", i) })),
    dropped: 0,
  });

  it("present: the first snapshot carries the trains and stations as read, and the backend's schema accepts it", async () => {
    const { sampler } = setup({ readMapLive: live([train(1)], [station(1), station(2)]) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot.mapLive).toEqual({ trains: [train(1)], stations: [station(1), station(2)] });
    expect(valid(snapshot)).toBe(true);
  });

  it("follows the factory cadence (30 s), not the status one", async () => {
    const { sampler, reader } = setup({ readMapLive: live([train(1)], []) });
    await sampler.sample(T0);
    expect((await sampler.sample(T0 + 5_000)).mapLive).toBeUndefined();
    expect((await sampler.sample(T0 + 30_000)).mapLive).toBeDefined();
    expect(reader.readMapLive).toHaveBeenCalledTimes(2);
  });

  it("absent on failure: the snapshot goes without mapLive (the rest intact and valid), logged once per streak, then recovered", async () => {
    let fail = true;
    const { sampler, events } = setup({ readMapLive: vi.fn(async () => (fail ? Promise.reject(unreachable()) : { trains: [train(1)], stations: [], dropped: 0 })) });
    for (let pass = 0; pass < 4; pass++) {
      const snapshot = await sampler.sample(T0 + pass * 30_000);
      expect(snapshot).not.toHaveProperty("mapLive");
      expect(snapshot.factory).toBeDefined();
      expect(valid(snapshot)).toBe(true);
    }
    const failures = events.filter((e) => e.event === "read_failed" && e.fields?.part === "map_live");
    expect(failures).toEqual([{ level: "warn", event: "read_failed", fields: { part: "map_live", code: "upstream_unreachable" } }]);
    expect(JSON.stringify(events)).not.toContain("TOKEN-abc-123");
    fail = false;
    expect((await sampler.sample(T0 + 120_000)).mapLive).toEqual({ trains: [train(1)], stations: [] });
    expect(events.filter((e) => e.event === "read_recovered" && e.fields?.part === "map_live")).toHaveLength(1);
  });

  it("capped: at most 500 of each kind, the cut entries counted in the adjusted warning", async () => {
    const trains = Array.from({ length: 600 }, (_, i) => train(i));
    const stations = Array.from({ length: 700 }, (_, i) => station(i));
    const { sampler, events } = setup({ readMapLive: live(trains, stations) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot.mapLive!.trains).toHaveLength(MAP_LIVE_AGENT_MAX_ITEMS);
    expect(snapshot.mapLive!.stations).toHaveLength(MAP_LIVE_AGENT_MAX_ITEMS);
    expect(snapshot.mapLive!.trains[0]).toEqual(train(0));
    expect(valid(snapshot)).toBe(true);
    expect(events).toContainEqual({ level: "warn", event: "readings_adjusted", fields: { entries: 300 } });
  });

  it("capped: a part over 256 KB is left out (never sent cut short by bytes), warned once per streak", async () => {
    const { sampler, events } = setup({ readMapLive: vi.fn(async () => overByteCap()) });
    for (let pass = 0; pass < 3; pass++) {
      const snapshot = await sampler.sample(T0 + pass * 30_000);
      expect(snapshot).not.toHaveProperty("mapLive");
      expect(valid(snapshot)).toBe(true);
    }
    const overCap = events.filter((e) => e.event === "map_live_over_cap");
    expect(overCap).toHaveLength(1);
    expect(overCap[0]!.fields).toMatchObject({ maxBytes: MAP_LIVE_AGENT_MAX_BYTES });
    expect(overCap[0]!.fields!.bytes).toBeGreaterThan(MAP_LIVE_AGENT_MAX_BYTES);
  });

  it("edge: a part back under 256 KB is sent again, and a later breach warns again", async () => {
    let big = true;
    const { sampler, events } = setup({ readMapLive: vi.fn(async () => (big ? overByteCap() : { trains: [train(1)], stations: [], dropped: 0 })) });
    await sampler.sample(T0);
    big = false;
    expect((await sampler.sample(T0 + 30_000)).mapLive).toEqual({ trains: [train(1)], stations: [] });
    big = true;
    await sampler.sample(T0 + 60_000);
    expect(events.filter((e) => e.event === "map_live_over_cap")).toHaveLength(2);
  });

  it("edge: exactly 500 of each kind is sent whole with no adjusted warning (the cap is inclusive)", async () => {
    const { sampler, events } = setup({ readMapLive: live(Array.from({ length: 500 }, (_, i) => train(i)), Array.from({ length: 500 }, (_, i) => station(i))) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot.mapLive!.trains).toHaveLength(500);
    expect(snapshot.mapLive!.stations).toHaveLength(500);
    expect(snapshot.mapLive!.trains[499]).toEqual(train(499));
    expect(events.some((e) => e.event === "readings_adjusted")).toBe(false);
    expect(valid(snapshot)).toBe(true);
  });

  it("edge: empty lists are still sent (no trains is a reading, not a failure)", async () => {
    const { sampler } = setup({ readMapLive: live([], []) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot.mapLive).toEqual({ trains: [], stations: [] });
    expect(valid(snapshot)).toBe(true);
  });

  it("edge: over-long ids, names and statuses are cut to the contract's 200 characters, and counted", async () => {
    const long = "x".repeat(250);
    const { sampler, events } = setup({ readMapLive: live([{ id: long, name: long, x: 1, y: 2, status: long }], [{ id: long, name: long, x: 3, y: 4 }]) });
    const snapshot = await sampler.sample(T0);
    expect(snapshot.mapLive!.trains[0]).toEqual({ id: "x".repeat(200), name: "x".repeat(200), x: 1, y: 2, status: "x".repeat(200) });
    expect(snapshot.mapLive!.stations[0]).toEqual({ id: "x".repeat(200), name: "x".repeat(200), x: 3, y: 4 });
    expect(valid(snapshot)).toBe(true);
    expect(events).toContainEqual({ level: "warn", event: "readings_adjusted", fields: { entries: 5 } });
  });

  it("edge: items the mappers dropped (a bad coordinate) are counted in the adjusted warning", async () => {
    const { sampler, events } = setup({ readMapLive: live([train(1)], [], 4) });
    await sampler.sample(T0);
    expect(events).toContainEqual({ level: "warn", event: "readings_adjusted", fields: { entries: 4 } });
  });

  it("edge: an unreachable game sends no mapLive and does not read it; a reader without the method sends none", async () => {
    const down = setup({ readStatus: vi.fn(async () => Promise.reject(unreachable())), readMapLive: live([train(1)], []) });
    const snapshot = await down.sampler.sample(T0);
    expect(snapshot).not.toHaveProperty("mapLive");
    expect(down.reader.readMapLive).not.toHaveBeenCalled();
    expect(valid(snapshot)).toBe(true);
    const old = setup();
    expect(await old.sampler.sample(T0)).not.toHaveProperty("mapLive");
  });
});

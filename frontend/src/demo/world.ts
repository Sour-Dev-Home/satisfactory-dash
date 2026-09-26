import type { z } from "zod";
import type {
  AgentStatusResponse,
  EnrollmentCodeResponseSchema,
  FactoryBuilding,
  FactoryResponse,
  HistoryItemsResponse,
  HistoryPowerResponse,
  HistoryRange,
  HistoryTransitions,
  HistoryTransitionsResponse,
  TransitionRange,
  ManagedServerListResponse,
  PowerCircuit,
  PowerHistoryPoint,
  PowerHistoryResponse,
  PowerResponse,
  ServerListResponse,
  ServerPlayersResponse,
  SettingsResponse,
  StatusResponse,
} from "@satisfactory-dash/shared";

/**
 * The demo world (ADR-0026): a small, presentable factory, made up for the demo, with no
 * personal names and nothing from a real save. Every response is built from the time, so the
 * power chart moves and two reads a moment apart agree. demo/world.test.ts checks each one
 * against the shared schemas, so the demo can't drift from the real contract.
 */

export const DEMO_SERVER_ID = "demo";

const envelope = (now: number) => ({
  serverId: DEMO_SERVER_ID,
  observedAt: new Date(now).toISOString(),
  stale: false,
});

const round1 = (value: number) => Math.round(value * 10) / 10;

// The visitor is the operator, so the Servers screens can be shown (ADR-0030), and the server's
// owner, so the Alerts page shows its controls (ADR-0027 PR 9c). Nothing they do is saved
// beyond the page (demo/handlers.ts, demo/alerts.ts).
export const servers: ServerListResponse = {
  servers: [{ id: DEMO_SERVER_ID, displayName: "Demo factory", role: "owner" }],
  canManageServers: true,
};

export const managedServers: ManagedServerListResponse = {
  servers: [
    {
      id: DEMO_SERVER_ID,
      displayName: "Demo factory",
      host: "127.0.0.1",
      apiPort: 7777,
      frmPort: 8080,
      apiTokenSet: true,
      apiTokenLast4: "d3m0",
      frmTokenSet: true,
      frmTokenLast4: "f4k3",
      state: "ok",
      plainHttpOverLan: false,
    },
  ],
};

/** The demo save's play time: about 36 days at DEMO_EPOCH, growing with the clock. */
export const DEMO_EPOCH = Date.parse("2026-09-24T18:00:00.000Z");
const PLAY_TIME_AT_EPOCH_S = 3_100_000;

/**
 * Players come and go (the cards brief): one step every 30 s through a 5-minute cycle that
 * visits every count from 0 to the limit. 3 at DEMO_EPOCH, so the fixed-clock renders (the
 * e2e, the walkthrough video) show "3 / 4 players".
 */
const PLAYER_CYCLE = [3, 3, 4, 4, 2, 1, 0, 0, 1, 2] as const;
const PLAYER_STEP_MS = 30_000;
export function connectedPlayersAt(now: number): number {
  const step = Math.floor((now - DEMO_EPOCH) / PLAYER_STEP_MS);
  return PLAYER_CYCLE[((step % PLAYER_CYCLE.length) + PLAYER_CYCLE.length) % PLAYER_CYCLE.length];
}

/**
 * Who is online (ADR-0029). The names are invented for the demo (the demo rule: never real
 * people, never the test fixtures); the first N are online, N following the cycle above, so
 * the names always agree with the count.
 */
const DEMO_PLAYERS = ["Rook", "Juniper", "Tinker", "Moss"] as const;

export function players(now: number): ServerPlayersResponse {
  const online = connectedPlayersAt(now);
  return { available: true, players: DEMO_PLAYERS.map((name, i) => ({ name, online: i < online })) };
}

/**
 * The server tick: around 29.6 ticks/s, with a 40-second "slow" episode (about 7 ticks/s, the
 * dial's red zone) once every 10 minutes, so the demo can show every tick state. The episode
 * starts 5 minutes after DEMO_EPOCH, so the fixed-clock renders stay healthy.
 */
const SLOW_CYCLE_MS = 600_000;
const SLOW_FROM_MS = 300_000;
const SLOW_FOR_MS = 40_000;
export function tickAt(now: number): { tickRate: number; tickHealth: "healthy" | "slow" } {
  const inCycle = (((now - DEMO_EPOCH) % SLOW_CYCLE_MS) + SLOW_CYCLE_MS) % SLOW_CYCLE_MS;
  const slow = inCycle >= SLOW_FROM_MS && inCycle < SLOW_FROM_MS + SLOW_FOR_MS;
  return slow
    ? { tickRate: round1(7.2 + 0.4 * Math.sin(now / 5_000)), tickHealth: "slow" }
    : { tickRate: round1(29.6 + 0.3 * Math.sin(now / 17_000)), tickHealth: "healthy" };
}

export function status(now: number): StatusResponse {
  return {
    ...envelope(now),
    data: {
      ...tickAt(now),
      isGameRunning: true,
      gamePaused: false,
      sessionName: "Demo World",
      connectedPlayers: connectedPlayersAt(now),
      playerLimit: 4,
      totalGameDurationSeconds: Math.max(0, Math.floor(PLAY_TIME_AT_EPOCH_S + (now - DEMO_EPOCH) / 1000)),
    },
  };
}

/** Circuit readings at time t (ms): smooth, deterministic wobble, always within capacity. */
function circuitAt(circuitGroupId: 0 | 1, t: number): Omit<PowerCircuit, "status"> {
  if (circuitGroupId === 0) {
    const production = 4200 + 180 * Math.sin(t / 47_000) + 90 * Math.sin(t / 13_000);
    const consumption = 3850 + 140 * Math.sin(t / 29_000) + 60 * Math.sin(t / 11_000);
    return {
      circuitGroupId,
      productionMW: round1(production),
      consumptionMW: round1(consumption),
      capacityMW: 6000,
      maxConsumptionMW: 5400,
      fuseTriggered: false,
      batteryCapacityMWh: 400,
      batteryPercent: round1(60 + 25 * Math.sin(t / 300_000)),
      batteryDifferentialMW: round1(production - consumption),
    };
  }
  return {
    circuitGroupId,
    productionMW: round1(120 + 5 * Math.sin(t / 19_000)),
    consumptionMW: round1(96 + 8 * Math.sin(t / 23_000)),
    capacityMW: 150,
    maxConsumptionMW: 130,
    fuseTriggered: false,
    batteryCapacityMWh: 0,
    batteryPercent: 0,
    batteryDifferentialMW: 0,
  };
}

export function power(now: number): PowerResponse {
  return {
    ...envelope(now),
    data: {
      circuits: [0, 1].map((id) => ({ ...circuitAt(id as 0 | 1, now), status: "ok" as const })),
      hasOutage: false,
    },
  };
}

const SAMPLE_MS = 5000;
const WINDOW_SECONDS = 300;

/** The last window of 5 s samples, from the same readings as power(), ending before `now`. */
export function powerHistory(now: number): PowerHistoryResponse {
  const newest = Math.floor(now / SAMPLE_MS) * SAMPLE_MS;
  const count = WINDOW_SECONDS / (SAMPLE_MS / 1000);
  const times = Array.from({ length: count }, (_, i) => newest - (count - 1 - i) * SAMPLE_MS);
  const points = (id: 0 | 1): PowerHistoryPoint[] =>
    times.map((t) => {
      const c = circuitAt(id, t);
      return {
        t,
        productionMW: c.productionMW,
        consumptionMW: c.consumptionMW,
        capacityMW: c.capacityMW,
        batteryPercent: c.batteryPercent,
        fuseTriggered: c.fuseTriggered,
      };
    });
  return {
    ...envelope(newest),
    data: {
      windowSeconds: WINDOW_SECONDS,
      intervalSeconds: SAMPLE_MS / 1000,
      series: [
        { circuitGroupId: 0, points: points(0) },
        { circuitGroupId: 1, points: points(1) },
      ],
      pausedRanges: [],
    },
  };
}

/** ADR-0027's table (packages/shared/src/history.ts): the range picks the bucket, in seconds. */
const RANGE_MS: Record<HistoryRange, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "1y": 31_536_000_000,
};
const BUCKET_S: Record<HistoryRange, number> = { "1h": 60, "6h": 60, "24h": 300, "7d": 3600, "30d": 21_600, "1y": 86_400 };
/** The demo save, as the stored history's session hash (any fixed 32-bit number). */
const DEMO_SESSION = 20_260_924;
// A stretch with nothing recorded (the game was paused), a few buckets before the newest one, so
// every range can show a gap. Sized in buckets, not a fixed clock time: a 1h range's window (60
// one-minute buckets) never reaches back 28-30 hours, so a fixed-time gap would only ever show up
// in the 7d/30d/1y ranges. (test-hunter: found via demo/world.test.ts, was previously hours-based.)
const GAP_BUCKETS = 2;
const GAP_BUCKETS_AGO = 4;

/**
 * Stored power history (ADR-0027) for a range, from the same readings as power(): each bucket
 * samples its circuit a few times for min/avg/max. Nothing in the gap, as the real history does.
 */
export function historyPower(now: number, range: HistoryRange): HistoryPowerResponse {
  const step = BUCKET_S[range] * 1000;
  const to = now;
  const from = now - RANGE_MS[range];
  const first = Math.ceil(from / step) * step;
  const starts: number[] = [];
  // Every bucket that has started (the newest is still filling, as on the real backend).
  for (let t = first; t < now; t += step) starts.push(t);
  const gapEnd = Math.max(0, starts.length - GAP_BUCKETS_AGO);
  const gapStart = Math.max(0, gapEnd - GAP_BUCKETS);
  starts.splice(gapStart, gapEnd - gapStart);
  const stat = (values: number[]) => ({
    min: round1(Math.min(...values)),
    avg: round1(values.reduce((a, b) => a + b, 0) / values.length),
    max: round1(Math.max(...values)),
  });
  const points = (id: 0 | 1) =>
    starts.map((t) => {
      const samples = Array.from({ length: 6 }, (_, i) => circuitAt(id, t + (i * step) / 6));
      return {
        t,
        samples: Math.max(1, Math.round(step / SAMPLE_MS)),
        productionMW: stat(samples.map((c) => c.productionMW)),
        consumptionMW: stat(samples.map((c) => c.consumptionMW)),
        capacityMW: samples[0].capacityMW,
        batteryPercent: stat(samples.map((c) => c.batteryPercent)),
        fuseTrippedSamples: 0,
      };
    });
  return {
    ...envelope(now),
    data: {
      range,
      resolutionSeconds: BUCKET_S[range],
      from,
      to,
      series: [
        { session: DEMO_SESSION, circuit: 0, points: points(0) },
        { session: DEMO_SESSION, circuit: 1, points: points(1) },
      ],
    },
  };
}

type Output = [name: string, className: string, current: number, max: number, unit?: "m3/min"];

const rates = (items: Output[]) =>
  items.map(([itemName, itemClass, current, max, unit]) => ({
    name: itemName,
    className: itemClass,
    unit: unit ?? ("items/min" as const),
    currentPerMinute: current,
    maxPerMinute: max,
    percent: max === 0 ? 0 : round1((current / max) * 100),
  }));

function building(
  n: number,
  name: string,
  className: string,
  recipe: string | null,
  [inputs, outputs]: [Output[], Output[]],
  place: { x: number; y: number; rot: number; circuit: 0 | 1 },
  state: "producing" | "underfed" | "backedUp" = "producing",
  clockSpeedPercent = 100,
): FactoryBuilding {
  return {
    id: `demo-${n}`,
    name,
    className,
    recipe,
    isProducing: recipe !== null && state !== "backedUp",
    isPaused: false,
    isBackedUp: state === "backedUp",
    production: rates(outputs),
    ingredients: rates(inputs),
    state,
    clockSpeedPercent,
    location: { xM: place.x, yM: place.y, zM: 12, rotationDeg: place.rot },
    circuitGroupId: place.circuit,
  };
}

const ORE: Output = ["Iron Ore", "Desc_OreIron_C", 30, 30];

/** Nine machines on two circuits; one backed up and one underfed, so the page has something to point at. */
const buildings: FactoryBuilding[] = [
  building(1, "Smelter", "Build_SmelterMk1_C", "Iron Ingot", [[ORE], [["Iron Ingot", "Desc_IronIngot_C", 30, 30]]], { x: -1720, y: -980, rot: 0, circuit: 0 }),
  // Overclocked with a power shard: 150% of the recipe's 30 per minute.
  building(
    2,
    "Smelter",
    "Build_SmelterMk1_C",
    "Iron Ingot",
    [[["Iron Ore", "Desc_OreIron_C", 45, 45]], [["Iron Ingot", "Desc_IronIngot_C", 45, 45]]],
    { x: -1720, y: -990, rot: 0, circuit: 0 },
    "producing",
    150,
  ),
  building(
    3,
    "Constructor",
    "Build_ConstructorMk1_C",
    "Iron Plate",
    [[["Iron Ingot", "Desc_IronIngot_C", 30, 30]], [["Iron Plate", "Desc_IronPlate_C", 20, 20]]],
    { x: -1700, y: -980, rot: 90, circuit: 0 },
  ),
  building(
    4,
    "Constructor",
    "Build_ConstructorMk1_C",
    "Iron Rod",
    [[["Iron Ingot", "Desc_IronIngot_C", 15, 15]], [["Iron Rod", "Desc_IronRod_C", 15, 15]]],
    { x: -1700, y: -990, rot: 90, circuit: 0 },
  ),
  // Short of rods: under 95% of its rate (ADR-0027 amendment 2), so underfed.
  building(
    5,
    "Constructor",
    "Build_ConstructorMk1_C",
    "Screw",
    [[["Iron Rod", "Desc_IronRod_C", 7.5, 10]], [["Screw", "Desc_IronScrew_C", 30, 40]]],
    { x: -1690, y: -990, rot: 90, circuit: 0 },
    "underfed",
  ),
  building(
    6,
    "Assembler",
    "Build_AssemblerMk1_C",
    "Reinforced Iron Plate",
    [
      [
        ["Iron Plate", "Desc_IronPlate_C", 30, 30],
        ["Screw", "Desc_IronScrew_C", 60, 60],
      ],
      [["Reinforced Iron Plate", "Desc_IronPlateReinforced_C", 5, 5]],
    ],
    { x: -1675, y: -985, rot: 180, circuit: 0 },
  ),
  building(
    7,
    "Assembler",
    "Build_AssemblerMk1_C",
    "Rotor",
    [
      [
        ["Iron Rod", "Desc_IronRod_C", 0, 20],
        ["Screw", "Desc_IronScrew_C", 0, 100],
      ],
      [["Rotor", "Desc_Rotor_C", 0, 4]],
    ],
    { x: -1675, y: -1000, rot: 180, circuit: 0 },
    "backedUp",
  ),
  building(
    8,
    "Manufacturer",
    "Build_ManufacturerMk1_C",
    "Modular Frame",
    [
      [
        ["Reinforced Iron Plate", "Desc_IronPlateReinforced_C", 3, 3],
        ["Iron Rod", "Desc_IronRod_C", 12, 12],
      ],
      [["Modular Frame", "Desc_ModularFrame_C", 2, 2]],
    ],
    { x: -1655, y: -990, rot: 270, circuit: 0 },
  ),
  building(
    9,
    "Refinery",
    "Build_OilRefinery_C",
    "Plastic",
    [
      [["Crude Oil", "Desc_LiquidOil_C", 30, 30, "m3/min"]],
      [
        ["Plastic", "Desc_Plastic_C", 20, 20],
        ["Heavy Oil Residue", "Desc_HeavyOilResidue_C", 10, 10, "m3/min"],
      ],
    ],
    { x: -1540, y: -870, rot: 0, circuit: 1 },
  ),
];

/** What the backend counts (ADR-0027): machines per state; ones without a state aren't counted. */
function stateCounts(list: FactoryBuilding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { state } of list) if (state) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

export function factory(now: number): FactoryResponse {
  return {
    ...envelope(now),
    data: {
      buildings,
      backedUpCount: buildings.filter((b) => b.isBackedUp).length,
      stateCounts: stateCounts(buildings),
    },
  };
}

export function settings(now: number, state: { autoPause: boolean; pending: boolean }): SettingsResponse {
  return { ...envelope(now), data: { ...state, editable: true } };
}

/** The demo's game PC agent (ADR-0031 PR 7): enrolled, and heard from a few seconds ago. */
export function agent(now: number): AgentStatusResponse {
  return { enrolled: true, lastSeenAt: new Date(now - 12_000).toISOString(), agentVersion: "0.1.0", connectionKind: "agent" };
}

/** A made-up enrolment code: it enrols nothing, since the demo has no backend. */
export function enrollmentCode(now: number): z.infer<typeof EnrollmentCodeResponseSchema> {
  return { code: "DEMO-DEMO", expiresAt: new Date(now + 10 * 60_000).toISOString() };
}

// Stored production history (ADR-0027 decision 3), invented like the rest: the demo's own items, a
// gentle daily wave, a paused stretch two days ago (a gap), and a visible dip (ADR-0027 item 7):
// the Rotor assembler backed up 5 hours ago and the Screw line has been short of rods for 6.

const MINUTE = 60_000;
const HOUR_MS = 60 * MINUTE;
const DAY_MS = 24 * HOUR_MS;
// The range→bucket table is the power history's RANGE_MS / BUCKET_S above: one copy for both.

/** Factory-wide rate and capacity per item before the dips, highest first (the order the backend sends). */
const HISTORY_ITEMS: [className: string, perMinute: number, capacity: number][] = [
  ["Desc_IronIngot_C", 75, 75],
  ["Desc_IronScrew_C", 40, 40],
  ["Desc_IronPlate_C", 20, 20],
  ["Desc_Plastic_C", 20, 20],
  ["Desc_IronRod_C", 15, 15],
  ["Desc_HeavyOilResidue_C", 10, 10],
  ["Desc_IronPlateReinforced_C", 5, 5],
  ["Desc_Rotor_C", 4, 4],
  ["Desc_ModularFrame_C", 2, 2],
];

/** Whether the game was running at `t` (a 2-hour pause two days before `now`). */
const recordedAt = (t: number, now: number) => t < now - 50 * HOUR_MS || t >= now - 48 * HOUR_MS;

/** An item's rate per minute at `t`, relative to `now` so the demo always shows the same story. */
function itemRate(className: string, perMinute: number, t: number, now: number): number {
  if (className === "Desc_Rotor_C" && t >= now - 5 * HOUR_MS) return 0;
  if (className === "Desc_IronScrew_C" && t >= now - 6 * HOUR_MS) return 30;
  const wave = 1 + 0.03 * Math.sin((2 * Math.PI * (t % DAY_MS)) / DAY_MS);
  return round1(Math.min(perMinute, perMinute * wave));
}

export function historyItems(now: number, range: HistoryRange, item?: string): HistoryItemsResponse {
  const bucket = BUCKET_S[range] * 1000;
  const from = now - RANGE_MS[range];
  const first = Math.floor(from / bucket) * bucket;
  const series = HISTORY_ITEMS.filter(([className]) => item === undefined || className === item).map(
    ([className, perMinute, capacity]) => {
      const points = [];
      for (let t = first; t <= now; t += bucket) {
        // Samples every 30 s, probed at most 60 times a bucket (a 1-day bucket holds 2,880), so a year
        // stays fast in the browser. A bucket that straddles the pause keeps only what was recorded.
        const step = Math.max(1, Math.floor(bucket / 30_000 / 60)) * 30_000;
        const probes = Array.from({ length: Math.max(1, bucket / step) }, (_, i) => t + i * step).filter(
          (s) => s <= now && recordedAt(s, now),
        );
        if (probes.length === 0) continue;
        const rates = probes.map((s) => itemRate(className, perMinute, s, now));
        const avg = round1(rates.reduce((a, r) => a + r, 0) / rates.length);
        points.push({
          t,
          samples: (probes.length * step) / 30_000,
          currentPerMinute: { min: Math.min(...rates), avg, max: Math.max(...rates) },
          maxPerMinute: capacity,
        });
      }
      return { item: className, points };
    },
  );
  return {
    ...envelope(now),
    data: { range, resolutionSeconds: bucket / 1000, from, to: now, truncated: false, series },
  };
}

/** The Screw constructor flips between producing and underfed every 40 minutes; the Rotor assembler backed up. */
export function historyTransitions(now: number, range: TransitionRange, limit: number): HistoryTransitionsResponse {
  const from = now - RANGE_MS[range];
  const all: HistoryTransitions["transitions"] = [];
  const cadence = 40 * MINUTE;
  for (let t = Math.floor(now / cadence) * cadence, i = 0; t >= from; t -= cadence, i++) {
    if (!recordedAt(t, now)) continue;
    const underfed = Math.floor(t / cadence) % 2 === 0;
    all.push({
      t,
      buildingId: "demo-5",
      className: "Build_ConstructorMk1_C",
      fromState: underfed ? "producing" : "underfed",
      toState: underfed ? "underfed" : "producing",
    });
  }
  const backedUpAt = now - 5 * HOUR_MS;
  if (backedUpAt >= from) {
    all.push({ t: backedUpAt, buildingId: "demo-7", className: "Build_AssemblerMk1_C", fromState: "producing", toState: "backedUp" });
  }
  all.sort((a, b) => b.t - a.t);
  return {
    ...envelope(now),
    data: { range, from, to: now, truncated: all.length > limit, transitions: all.slice(0, limit) },
  };
}

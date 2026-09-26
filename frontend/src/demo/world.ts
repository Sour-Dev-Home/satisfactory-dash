import type {
  FactoryBuilding,
  FactoryResponse,
  HistoryItemsResponse,
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

// The visitor is the operator, so the Servers screens can be shown (ADR-0030). Nothing they do
// there is saved (demo/handlers.ts).
export const servers: ServerListResponse = {
  servers: [{ id: DEMO_SERVER_ID, displayName: "Demo factory" }],
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

type Output = [name: string, className: string, current: number, max: number, unit?: "m3/min"];

function building(
  n: number,
  name: string,
  className: string,
  recipe: string | null,
  outputs: Output[],
  place: { x: number; y: number; rot: number; circuit: 0 | 1 },
  backedUp = false,
): FactoryBuilding {
  return {
    id: `demo-${n}`,
    name,
    className,
    recipe,
    isProducing: recipe !== null && !backedUp,
    isPaused: false,
    isBackedUp: backedUp,
    production: outputs.map(([itemName, itemClass, current, max, unit]) => ({
      name: itemName,
      className: itemClass,
      unit: unit ?? "items/min",
      currentPerMinute: current,
      maxPerMinute: max,
      percent: max === 0 ? 0 : round1((current / max) * 100),
    })),
    location: { xM: place.x, yM: place.y, zM: 12, rotationDeg: place.rot },
    circuitGroupId: place.circuit,
  };
}

/** Nine machines on two circuits; one backed up, so the page has something to point at. */
const buildings: FactoryBuilding[] = [
  building(1, "Smelter", "Build_SmelterMk1_C", "Iron Ingot", [["Iron Ingot", "Desc_IronIngot_C", 30, 30]], { x: -1720, y: -980, rot: 0, circuit: 0 }),
  building(2, "Smelter", "Build_SmelterMk1_C", "Iron Ingot", [["Iron Ingot", "Desc_IronIngot_C", 30, 30]], { x: -1720, y: -990, rot: 0, circuit: 0 }),
  building(3, "Constructor", "Build_ConstructorMk1_C", "Iron Plate", [["Iron Plate", "Desc_IronPlate_C", 20, 20]], { x: -1700, y: -980, rot: 90, circuit: 0 }),
  building(4, "Constructor", "Build_ConstructorMk1_C", "Iron Rod", [["Iron Rod", "Desc_IronRod_C", 15, 15]], { x: -1700, y: -990, rot: 90, circuit: 0 }),
  building(5, "Constructor", "Build_ConstructorMk1_C", "Screw", [["Screw", "Desc_IronScrew_C", 38, 40]], { x: -1690, y: -990, rot: 90, circuit: 0 }),
  building(6, "Assembler", "Build_AssemblerMk1_C", "Reinforced Iron Plate", [["Reinforced Iron Plate", "Desc_IronPlateReinforced_C", 5, 5]], { x: -1675, y: -985, rot: 180, circuit: 0 }),
  building(7, "Assembler", "Build_AssemblerMk1_C", "Rotor", [["Rotor", "Desc_Rotor_C", 0, 4]], { x: -1675, y: -1000, rot: 180, circuit: 0 }, true),
  building(8, "Manufacturer", "Build_ManufacturerMk1_C", "Modular Frame", [["Modular Frame", "Desc_ModularFrame_C", 2, 2]], { x: -1655, y: -990, rot: 270, circuit: 0 }),
  building(
    9,
    "Refinery",
    "Build_OilRefinery_C",
    "Plastic",
    [
      ["Plastic", "Desc_Plastic_C", 20, 20],
      ["Heavy Oil Residue", "Desc_HeavyOilResidue_C", 10, 10, "m3/min"],
    ],
    { x: -1540, y: -870, rot: 0, circuit: 1 },
  ),
];

export function factory(now: number): FactoryResponse {
  return {
    ...envelope(now),
    data: { buildings, backedUpCount: buildings.filter((b) => b.isBackedUp).length },
  };
}

export function settings(now: number, state: { autoPause: boolean; pending: boolean }): SettingsResponse {
  return { ...envelope(now), data: { ...state, editable: true } };
}

// Stored production history (ADR-0027 decision 3), invented like the rest: the demo's own items, a
// gentle daily wave, a paused stretch two days ago (a gap), and a visible dip (ADR-0027 item 7):
// the Rotor assembler backed up 5 hours ago and the Screw line has been short of rods for 6.

const MINUTE = 60_000;
const HOUR_MS = 60 * MINUTE;
const DAY_MS = 24 * HOUR_MS;
/** The range picks the bucket, as the backend does (packages/shared/src/history.ts). */
const BUCKET_MS: Record<HistoryRange, number> = {
  "1h": MINUTE,
  "6h": MINUTE,
  "24h": 5 * MINUTE,
  "7d": HOUR_MS,
  "30d": 6 * HOUR_MS,
  "1y": DAY_MS,
};
const RANGE_MS: Record<HistoryRange, number> = {
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "1y": 365 * DAY_MS,
};

/** Factory-wide rate and capacity per item before the dips, highest first (the order the backend sends). */
const HISTORY_ITEMS: [className: string, perMinute: number, capacity: number][] = [
  ["Desc_IronIngot_C", 75, 75],
  ["Desc_Screw_C", 40, 40],
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
  if (className === "Desc_Screw_C" && t >= now - 6 * HOUR_MS) return 30;
  const wave = 1 + 0.03 * Math.sin((2 * Math.PI * (t % DAY_MS)) / DAY_MS);
  return round1(Math.min(perMinute, perMinute * wave));
}

export function historyItems(now: number, range: HistoryRange, item?: string): HistoryItemsResponse {
  const bucket = BUCKET_MS[range];
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

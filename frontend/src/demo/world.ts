import type { z } from "zod";
import { isBackedUpState, ownValue } from "@satisfactory-dash/shared";
import type {
  AgentStatusResponse,
  BottlenecksResponse,
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
  MapLive,
  MapLiveResponse,
  PowerCircuit,
  PowerHistoryPoint,
  PowerHistoryResponse,
  PowerResponse,
  ProductionGraphResponse,
  RailsLayerData,
  RailsWorldLayerResponse,
  ResourceNodesLayerData,
  ResourceNodesWorldLayerResponse,
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
  return PLAYER_CYCLE.at(((step % PLAYER_CYCLE.length) + PLAYER_CYCLE.length) % PLAYER_CYCLE.length) ?? 0;
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

/** A range's length and bucket, reading own keys only (#368); the handlers validate the range first. */
function rangeMs(range: HistoryRange): number {
  const ms = ownValue(RANGE_MS, range);
  if (ms === undefined) throw new Error(`unknown history range: ${String(range)}`);
  return ms;
}
function bucketS(range: HistoryRange): number {
  const seconds = ownValue(BUCKET_S, range);
  if (seconds === undefined) throw new Error(`unknown history range: ${String(range)}`);
  return seconds;
}
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
  const step = bucketS(range) * 1000;
  const to = now;
  const from = now - rangeMs(range);
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
      resolutionSeconds: bucketS(range),
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
  /** Backed up by state only (issue 201): full input buffers and a slow output, but no output slot at capacity. */
  stateOnly = false,
): FactoryBuilding {
  return {
    id: `demo-${n}`,
    name,
    className,
    recipe,
    isProducing: recipe !== null && state !== "backedUp",
    isPaused: false,
    isBackedUp: state === "backedUp" && !stateOnly,
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
  // Output-throttled: input buffers full but running at 10% of its rate, so backedUp by state alone (issue 201).
  building(
    10,
    "Assembler",
    "Build_AssemblerMk1_C",
    "Reinforced Iron Plate",
    [
      [
        ["Iron Plate", "Desc_IronPlate_C", 3, 30],
        ["Screw", "Desc_IronScrew_C", 6, 60],
      ],
      [["Reinforced Iron Plate", "Desc_IronPlateReinforced_C", 0.5, 5]],
    ],
    { x: -1675, y: -975, rot: 180, circuit: 0 },
    "backedUp",
    100,
    true,
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
      backedUpCount: buildings.filter(isBackedUpState).length,
      stateCounts: stateCounts(buildings),
    },
  };
}

/**
 * The demo's bottleneck finder answer (ADR-0048, #349): made-up findings for the demo factory's two stressed
 * machines, one capped by a belt and one with nothing downstream to take its output. The conveyor ids and positions are the demo's own.
 */
export function bottlenecks(now: number): BottlenecksResponse {
  return {
    ...envelope(now),
    data: {
      findings: [
        {
          buildingId: "demo-5",
          buildingName: "Constructor",
          state: "underfed",
          rootCause: {
            kind: "logistics",
            itemClassName: "Desc_IronRod_C",
            itemName: "Iron Rod",
            supplyMaxPerMinute: 15,
            demandMaxPerMinute: 25,
            unit: "items/min",
            cappedBy: {
              conveyorId: "demo-belt-1",
              kind: "belt",
              tier: "Conveyor Belt Mk.1",
              capacityPerMinute: 60,
              fromId: "demo-4",
              toId: "demo-5",
              at: { x: -1698, y: -990 },
            },
          },
          chain: [],
          text: "A Conveyor Belt Mk.1 (60/min) from the Iron Rod Constructor near (-1698, -990) caps Iron Rod at 60/min; this Constructor wants 25.",
          recipe: "Screw",
          at: { x: -1690, y: -990 },
          affectedCount: 1,
          affected: [{ buildingId: "demo-5", buildingName: "Constructor", recipe: "Screw", at: { x: -1690, y: -990 } }],
        },
        {
          buildingId: "demo-7",
          buildingName: "Assembler",
          state: "backedUp",
          rootCause: {
            kind: "surplus",
            itemClassName: "Desc_Rotor_C",
            itemName: "Rotor",
            supplyMaxPerMinute: 4,
            demandMaxPerMinute: 0,
            unit: "items/min",
          },
          chain: [],
          text: "Rotor is made up to 4/min and nothing downstream takes it.",
          recipe: "Rotor",
          at: { x: -1675, y: -1000 },
          affectedCount: 1,
          affected: [{ buildingId: "demo-7", buildingName: "Assembler", recipe: "Rotor", at: { x: -1675, y: -1000 } }],
        },
      ],
      truncated: false,
      beltData: "present",
      connectionsRefreshMinutes: 10,
      notes: [{ code: "connectionsRefresh", text: "Connections refresh every 10 minutes." }],
    },
  };
}

type PlannerNodeData = ProductionGraphResponse["data"]["nodes"][number];
type PlannerEdgeData = ProductionGraphResponse["data"]["edges"][number];
type PlannerRateData = PlannerNodeData["products"][number];

const IRON_WORKS = "site|-1690|-990";
const OIL_OUTPOST = "site|-1540|-870";

const plannerRate = (className: string, name: string, current: number, max: number, unit: "items/min" | "m3/min" = "items/min"): PlannerRateData => ({
  className,
  name,
  unit,
  currentPerMinute: current,
  maxPerMinute: max,
});

function plannerNode(
  n: {
    kind: PlannerNodeData["kind"];
    className: string;
    name: string;
    recipe: string | null;
    ids: string[];
    states: Record<string, number>;
    at: { x: number; y: number };
    site: string;
    loop?: boolean;
    products?: PlannerRateData[];
    ingredients?: PlannerRateData[];
  },
): PlannerNodeData {
  return {
    key: `${n.className}|${n.recipe ?? ""}|${n.at.x}|${n.at.y}`,
    kind: n.kind,
    className: n.className,
    name: n.name,
    recipe: n.recipe,
    count: n.ids.length,
    machineIds: n.ids,
    stateCounts: n.states,
    products: n.products ?? [],
    ingredients: n.ingredients ?? [],
    at: n.at,
    siteKey: n.site,
    loop: n.loop ?? false,
  };
}

const PLANNER_NODES = {
  miner: plannerNode({
    kind: "extractor", className: "Build_MinerMk2_C", name: "Miner Mk.2", recipe: null, ids: ["demo-12"], states: { producing: 1 },
    at: { x: -1740, y: -985 }, site: IRON_WORKS, products: [plannerRate("Desc_OreIron_C", "Iron Ore", 75, 120)],
  }),
  smelters: plannerNode({
    kind: "machines", className: "Build_SmelterMk1_C", name: "Smelter", recipe: "Iron Ingot", ids: ["demo-1", "demo-2"], states: { producing: 2 },
    at: { x: -1720, y: -985 }, site: IRON_WORKS,
    products: [plannerRate("Desc_IronIngot_C", "Iron Ingot", 75, 75)], ingredients: [plannerRate("Desc_OreIron_C", "Iron Ore", 75, 75)],
  }),
  plates: plannerNode({
    kind: "machines", className: "Build_ConstructorMk1_C", name: "Constructor", recipe: "Iron Plate", ids: ["demo-3"], states: { producing: 1 },
    at: { x: -1700, y: -980 }, site: IRON_WORKS,
    products: [plannerRate("Desc_IronPlate_C", "Iron Plate", 20, 20)], ingredients: [plannerRate("Desc_IronIngot_C", "Iron Ingot", 30, 30)],
  }),
  rods: plannerNode({
    kind: "machines", className: "Build_ConstructorMk1_C", name: "Constructor", recipe: "Iron Rod", ids: ["demo-4"], states: { producing: 1 },
    at: { x: -1700, y: -990 }, site: IRON_WORKS, loop: true,
    products: [plannerRate("Desc_IronRod_C", "Iron Rod", 15, 15)], ingredients: [plannerRate("Desc_IronIngot_C", "Iron Ingot", 15, 15)],
  }),
  screws: plannerNode({
    kind: "machines", className: "Build_ConstructorMk1_C", name: "Constructor", recipe: "Screw", ids: ["demo-5"], states: { underfed: 1 },
    at: { x: -1690, y: -990 }, site: IRON_WORKS,
    products: [plannerRate("Desc_IronScrew_C", "Screw", 30, 40)], ingredients: [plannerRate("Desc_IronRod_C", "Iron Rod", 7.5, 10)],
  }),
  rotors: plannerNode({
    kind: "machines", className: "Build_AssemblerMk1_C", name: "Assembler", recipe: "Rotor", ids: ["demo-7"], states: { backedUp: 1 },
    at: { x: -1675, y: -1000 }, site: IRON_WORKS, loop: true,
    products: [plannerRate("Desc_Rotor_C", "Rotor", 0, 4)],
    ingredients: [plannerRate("Desc_IronRod_C", "Iron Rod", 0, 20), plannerRate("Desc_IronScrew_C", "Screw", 0, 100)],
  }),
  reinforced: plannerNode({
    kind: "machines", className: "Build_AssemblerMk1_C", name: "Assembler", recipe: "Reinforced Iron Plate", ids: ["demo-6", "demo-10"],
    states: { producing: 1, backedUp: 1 }, at: { x: -1675, y: -980 }, site: IRON_WORKS,
    products: [plannerRate("Desc_IronPlateReinforced_C", "Reinforced Iron Plate", 5.5, 10)],
    ingredients: [plannerRate("Desc_IronPlate_C", "Iron Plate", 33, 60), plannerRate("Desc_IronScrew_C", "Screw", 66, 120)],
  }),
  frames: plannerNode({
    kind: "machines", className: "Build_ManufacturerMk1_C", name: "Manufacturer", recipe: "Modular Frame", ids: ["demo-8"], states: { producing: 1 },
    at: { x: -1655, y: -990 }, site: IRON_WORKS,
    products: [plannerRate("Desc_ModularFrame_C", "Modular Frame", 2, 2)],
    ingredients: [plannerRate("Desc_IronPlateReinforced_C", "Reinforced Iron Plate", 3, 3), plannerRate("Desc_IronRod_C", "Iron Rod", 12, 12)],
  }),
  depot: plannerNode({
    kind: "storage", className: "Build_StorageContainerMk1_C", name: "Storage Container", recipe: null, ids: ["demo-11"], states: {},
    at: { x: -1640, y: -985 }, site: IRON_WORKS,
  }),
  oil: plannerNode({
    kind: "extractor", className: "Build_OilPump_C", name: "Oil Extractor", recipe: null, ids: ["demo-13"], states: { producing: 1 },
    at: { x: -1560, y: -860 }, site: OIL_OUTPOST, products: [plannerRate("Desc_LiquidOil_C", "Crude Oil", 30, 60, "m3/min")],
  }),
  refinery: plannerNode({
    kind: "machines", className: "Build_OilRefinery_C", name: "Refinery", recipe: "Plastic", ids: ["demo-9"], states: { producing: 1 },
    at: { x: -1540, y: -870 }, site: OIL_OUTPOST,
    products: [plannerRate("Desc_Plastic_C", "Plastic", 20, 20), plannerRate("Desc_HeavyOilResidue_C", "Heavy Oil Residue", 10, 10, "m3/min")],
    ingredients: [plannerRate("Desc_LiquidOil_C", "Crude Oil", 30, 30, "m3/min")],
  }),
  plasticStore: plannerNode({
    kind: "storage", className: "Build_StorageContainerMk1_C", name: "Storage Container", recipe: null, ids: ["demo-14"], states: {},
    at: { x: -1520, y: -875 }, site: OIL_OUTPOST,
  }),
  burner: plannerNode({
    kind: "consumer", className: "Build_GeneratorFuel_C", name: "Fuel Generator", recipe: null, ids: ["demo-15"], states: { producing: 1 },
    at: { x: -1530, y: -855 }, site: OIL_OUTPOST,
  }),
};

const N = PLANNER_NODES;
const plannerEdge = (
  from: PlannerNodeData,
  to: PlannerNodeData,
  item: [string, string] | null,
  rate: number | null,
  how: PlannerEdgeData["rate"],
  extra: Partial<PlannerEdgeData> = {},
): PlannerEdgeData => ({
  from: from.key,
  to: to.key,
  kind: "belt",
  itemClassName: item?.[0] ?? null,
  itemName: item?.[1] ?? null,
  ratePerMinute: rate,
  rate: how,
  mixed: false,
  capacityPerMinute: null,
  conveyorCount: 2,
  ...extra,
});

const ORE_ITEM: [string, string] = ["Desc_OreIron_C", "Iron Ore"];
const INGOT_ITEM: [string, string] = ["Desc_IronIngot_C", "Iron Ingot"];
const ROD_ITEM: [string, string] = ["Desc_IronRod_C", "Iron Rod"];
const SCREW_ITEM: [string, string] = ["Desc_IronScrew_C", "Screw"];
const RIP_ITEM: [string, string] = ["Desc_IronPlateReinforced_C", "Reinforced Iron Plate"];

/**
 * The demo's production planner (ADR-0050): two made-up sites. The iron works has a loop (overflow rods returning from the
 * rotor assembler), a mixed belt into its depot with no known rate, and estimated edges where a splitter shares a belt; the
 * oil outpost has pipes. The machine ids are the demo factory's, so the bottleneck counts join.
 */
export function productionGraph(now: number): ProductionGraphResponse {
  const nodes = Object.values(N);
  const siteNodes = (site: string) => nodes.filter((n) => n.siteKey === site);
  const siteOf = (site: string, name: string, at: { x: number; y: number }, outputs: PlannerRateData[]) => {
    const mine = siteNodes(site);
    const states: Record<string, number> = {};
    for (const n of mine) for (const [s, c] of Object.entries(n.stateCounts)) states[s] = (states[s] ?? 0) + c;
    return {
      key: site,
      name,
      at,
      machineCount: mine.reduce((sum, n) => sum + n.count, 0),
      stateCounts: states,
      topOutputs: outputs,
      nodeKeys: mine.map((n) => n.key),
    };
  };
  return {
    ...envelope(now),
    data: {
      nodes,
      edges: [
        plannerEdge(N.miner, N.smelters, ORE_ITEM, 75, "measured", { capacityPerMinute: 120, conveyorCount: 3 }),
        plannerEdge(N.smelters, N.plates, INGOT_ITEM, 30, "estimated", { conveyorCount: 6 }),
        plannerEdge(N.smelters, N.rods, INGOT_ITEM, 15, "estimated", { conveyorCount: 5 }),
        plannerEdge(N.rods, N.screws, ROD_ITEM, 7.5, "measured", { capacityPerMinute: 60 }),
        plannerEdge(N.rods, N.rotors, ROD_ITEM, 7.5, "estimated"),
        plannerEdge(N.rotors, N.rods, ROD_ITEM, 2.5, "estimated", { conveyorCount: 3 }),
        plannerEdge(N.screws, N.reinforced, SCREW_ITEM, 30, "measured", { capacityPerMinute: 60 }),
        plannerEdge(N.plates, N.reinforced, ["Desc_IronPlate_C", "Iron Plate"], 20, "measured", { capacityPerMinute: 60 }),
        plannerEdge(N.reinforced, N.frames, RIP_ITEM, 3, "measured"),
        plannerEdge(N.reinforced, N.depot, RIP_ITEM, null, "unknown", { mixed: true, conveyorCount: 4 }),
        plannerEdge(N.frames, N.depot, ["Desc_ModularFrame_C", "Modular Frame"], 2, "measured"),
        { ...plannerEdge(N.oil, N.refinery, ["Desc_LiquidOil_C", "Crude Oil"], 30, "measured", { capacityPerMinute: 300 }), kind: "pipe" },
        plannerEdge(N.refinery, N.plasticStore, ["Desc_Plastic_C", "Plastic"], 20, "estimated"),
        { ...plannerEdge(N.refinery, N.burner, ["Desc_HeavyOilResidue_C", "Heavy Oil Residue"], null, "unknown"), kind: "pipe" },
      ],
      sites: [
        siteOf(IRON_WORKS, "Iron works", { x: -1690, y: -990 }, [
          plannerRate("Desc_ModularFrame_C", "Modular Frame", 2, 2),
          plannerRate("Desc_IronPlateReinforced_C", "Reinforced Iron Plate", 5.5, 10),
        ]),
        siteOf(OIL_OUTPOST, "Oil outpost", { x: -1540, y: -866 }, [plannerRate("Desc_Plastic_C", "Plastic", 20, 20)]),
      ],
      unconnectedMachineIds: [],
      beltData: "present",
      connectionsRefreshMinutes: 10,
      notes: [{ code: "connectionsRefresh", text: "Connections refresh every 10 minutes." }],
    },
  };
}

/**
 * The demo's map world layers (ADR-0038 M5): made-up rails and resource nodes around the demo factory
 * (whole metres, +x east, +y south: docs-vault/raw-sources/world-coordinates.md). A world layer changes
 * rarely, so the demo's reading is "taken" ten minutes before the visit.
 */
const worldEnvelope = (now: number, layer: string, count: number) => ({
  layer,
  hash: `demo-${layer}`,
  observedAt: new Date(now - 10 * 60_000).toISOString(),
  truncated: false,
  count,
});

/** A gentle curve as short straight steps, from `a` to `b`, bowing out by `bow` metres. */
function arc(a: [number, number], b: [number, number], bow: number, steps = 12): [number, number][] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy) || 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const lift = Math.sin(Math.PI * t) * bow;
    return [Math.round(a[0] + dx * t - (dy / length) * lift), Math.round(a[1] + dy * t + (dx / length) * lift)];
  });
}

const DEMO_RAILS: RailsLayerData = [
  { id: "demo-rail-1", points: arc([-1900, -900], [-1560, -840], 30) },
  { id: "demo-rail-2", points: arc([-1560, -840], [-1100, -1100], -60) },
  { id: "demo-rail-3", points: arc([-1560, -840], [-1300, -600], 40) },
  { id: "demo-rail-4", points: arc([-1900, -900], [-2300, -1250], 50) },
];

const node = (type: string, purity: string, x: number, y: number, exploited: boolean, nodeType = "node") => ({
  type,
  purity,
  nodeType,
  x,
  y,
  exploited,
});
const DEMO_NODES: ResourceNodesLayerData = [
  node("Iron Ore", "pure", -1765, -1040, true),
  node("Iron Ore", "normal", -1830, -960, false),
  node("Copper Ore", "normal", -1610, -930, true),
  node("Limestone", "impure", -1500, -1050, false),
  node("Coal", "normal", -1380, -900, false),
  node("Caterium Ore", "pure", -1150, -1180, false),
  node("Sulfur", "impure", -2050, -760, false),
  node("Crude Oil", "pure", -1250, -700, false),
  node("Bauxite", "normal", -2240, -1290, false),
  node("Nitrogen Gas", "pure", -1000, -820, false, "frackingSatellite"),
  node("Geothermal", "normal", -1660, -690, false, "geyser"),
];

export function railsWorld(now: number): RailsWorldLayerResponse {
  return { ...worldEnvelope(now, "rails", DEMO_RAILS.length), data: DEMO_RAILS };
}

export function resourceNodesWorld(now: number): ResourceNodesWorldLayerResponse {
  return { ...worldEnvelope(now, "resourceNodes", DEMO_NODES.length), data: DEMO_NODES };
}

/** A point `u` (0 to 1) of the way along a polyline, by length, in whole metres. */
function pointAlong(points: readonly [number, number][], u: number): [number, number] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let left = u * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(1, left / lengths[i]);
      return [Math.round(points[i][0] + (points[i + 1][0] - points[i][0]) * t), Math.round(points[i][1] + (points[i + 1][1] - points[i][1]) * t)];
    }
    left -= lengths[i];
  }
  return points[0];
}

/** The demo's stations sit at the ends of its rails. */
const DEMO_STATIONS: MapLive["stations"] = [
  { id: "demo-station-1", name: "Iron Works Depot", x: -1900, y: -900 },
  { id: "demo-station-2", name: "Oil Outpost", x: -1100, y: -1100 },
  { id: "demo-station-3", name: "Coal Halt", x: -1300, y: -600 },
  { id: "demo-station-4", name: "Bauxite Siding", x: -2300, y: -1250 },
];

/** Back and forth along a track: a smooth 0 to 1 and back, once per `periodMs`, offset by `phase`. */
const there = (now: number, periodMs: number, phase: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (now / periodMs + phase));

/**
 * The demo's live trains (ADR-0038 M6): two made-up trains running back and forth over the demo rails,
 * their place worked out from the clock, so the map keeps moving as the visitor watches. Whole metres.
 */
export function mapLive(now: number): MapLiveResponse {
  const [a, b, c] = DEMO_RAILS;
  const long = [...a.points, ...b.points.slice(1)];
  const [x1, y1] = pointAlong(long, there(now, 6 * 60_000, 0));
  const [x2, y2] = pointAlong(c.points, there(now, 4 * 60_000, 0.3));
  return {
    ...envelope(now),
    data: {
      trains: [
        { id: "demo-train-1", name: "Iron Express", x: x1, y: y1, status: "Self-Driving" },
        { id: "demo-train-2", name: "Coal Shuttle", x: x2, y: y2, status: "Self-Driving" },
      ],
      stations: DEMO_STATIONS,
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
  return { code: "DEMO-DEMO-DEMO", expiresAt: new Date(now + 10 * 60_000).toISOString() };
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
  const bucket = bucketS(range) * 1000;
  const from = now - rangeMs(range);
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
  const from = now - rangeMs(range);
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

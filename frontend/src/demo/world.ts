import type {
  FactoryBuilding,
  FactoryResponse,
  PowerCircuit,
  PowerHistoryPoint,
  PowerHistoryResponse,
  PowerResponse,
  ServerListResponse,
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

export const servers: ServerListResponse = { servers: [{ id: DEMO_SERVER_ID, displayName: "Demo factory" }] };

/** The demo save's play time: about 36 days at DEMO_EPOCH, growing with the clock. */
export const DEMO_EPOCH = Date.parse("2026-09-24T18:00:00.000Z");
const PLAY_TIME_AT_EPOCH_S = 3_100_000;

export function status(now: number): StatusResponse {
  return {
    ...envelope(now),
    data: {
      tickHealth: "healthy",
      isGameRunning: true,
      gamePaused: false,
      sessionName: "Demo World",
      connectedPlayers: 3,
      playerLimit: 4,
      tickRate: round1(29.6 + 0.3 * Math.sin(now / 17_000)),
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

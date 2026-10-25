import type { ProductionGraphResponse } from "../src/index";

/**
 * ADR-0050: production-graph responses. SYNTHETIC: no capture records a planner graph (the service is PR 3). Two sites:
 * an iron line (miner -> 4x Smelter -> 8x Constructor manifold -> storage, with a loop back from a Constructor through
 * a recycler, and a mixed belt into the storage) and a small copper outpost; one machine on no conveyor yet.
 */

const CONNECTIONS_REFRESH = { code: "connectionsRefresh", text: "Connections refresh every 10 minutes." };
const rate = (className: string, name: string, currentPerMinute: number, maxPerMinute: number) => ({
  className,
  name,
  unit: "items/min" as const,
  currentPerMinute,
  maxPerMinute,
});

const IRON = "site|1200|-400";
const COPPER = "site|-2300|900";

export const productionGraphTwoSites = {
  serverId: "default",
  observedAt: "2026-10-23T15:05:00.000Z",
  stale: false,
  data: {
    nodes: [
      {
        key: "Build_MinerMk2_C||1150|-400",
        kind: "extractor",
        className: "Build_MinerMk2_C",
        name: "Miner Mk.2",
        recipe: null,
        count: 1,
        machineIds: ["Build_MinerMk2_C_1"],
        stateCounts: { producing: 1 },
        products: [rate("Desc_OreIron_C", "Iron Ore", 120, 120)],
        ingredients: [],
        at: { x: 1150, y: -400 },
        siteKey: IRON,
        loop: false,
      },
      {
        key: "Build_SmelterMk1_C|Iron Ingot|1200|-400",
        kind: "machines",
        className: "Build_SmelterMk1_C",
        name: "Smelter",
        recipe: "Iron Ingot",
        count: 4,
        machineIds: ["Build_SmelterMk1_C_1", "Build_SmelterMk1_C_2", "Build_SmelterMk1_C_3", "Build_SmelterMk1_C_4"],
        stateCounts: { producing: 4 },
        products: [rate("Desc_IronIngot_C", "Iron Ingot", 120, 120)],
        ingredients: [rate("Desc_OreIron_C", "Iron Ore", 120, 120)],
        at: { x: 1200, y: -400 },
        siteKey: IRON,
        loop: false,
      },
      {
        key: "Build_ConstructorMk1_C|Iron Plate|1250|-400",
        kind: "machines",
        className: "Build_ConstructorMk1_C",
        name: "Constructor",
        recipe: "Iron Plate",
        count: 8,
        machineIds: Array.from({ length: 8 }, (_, i) => `Build_ConstructorMk1_C_${i + 1}`),
        stateCounts: { producing: 6, underfed: 2 },
        products: [rate("Desc_IronPlate_C", "Iron Plate", 72, 160)],
        ingredients: [rate("Desc_IronIngot_C", "Iron Ingot", 108, 240)],
        at: { x: 1250, y: -400 },
        siteKey: IRON,
        loop: true,
      },
      {
        key: "Build_ConstructorMk1_C|Iron Plate Recycle|1260|-420",
        kind: "machines",
        className: "Build_ConstructorMk1_C",
        name: "Constructor",
        recipe: "Iron Plate Recycle",
        count: 1,
        machineIds: ["Build_ConstructorMk1_C_9"],
        stateCounts: { producing: 1 },
        products: [rate("Desc_IronIngot_C", "Iron Ingot", 6, 10)],
        ingredients: [rate("Desc_IronPlate_C", "Iron Plate", 4, 6)],
        at: { x: 1260, y: -420 },
        siteKey: IRON,
        loop: true,
      },
      {
        key: "Build_StorageContainerMk1_C||1300|-400",
        kind: "storage",
        className: "Build_StorageContainerMk1_C",
        name: "Storage Container",
        recipe: null,
        count: 1,
        machineIds: ["Build_StorageContainerMk1_C_1"],
        stateCounts: {},
        products: [],
        ingredients: [],
        at: { x: 1300, y: -400 },
        siteKey: IRON,
        loop: false,
      },
      {
        key: "Build_MinerMk1_C||-2300|900",
        kind: "extractor",
        className: "Build_MinerMk1_C",
        name: "Miner Mk.1",
        recipe: null,
        count: 1,
        machineIds: ["Build_MinerMk1_C_1"],
        stateCounts: { producing: 1 },
        products: [rate("Desc_OreCopper_C", "Copper Ore", 60, 60)],
        ingredients: [],
        at: { x: -2300, y: 900 },
        siteKey: COPPER,
        loop: false,
      },
      {
        key: "Build_SmelterMk1_C|Copper Ingot|-2290|900",
        kind: "machines",
        className: "Build_SmelterMk1_C",
        name: "Smelter",
        recipe: "Copper Ingot",
        count: 2,
        machineIds: ["Build_SmelterMk1_C_5", "Build_SmelterMk1_C_6"],
        stateCounts: { producing: 2 },
        products: [rate("Desc_CopperIngot_C", "Copper Ingot", 60, 60)],
        ingredients: [rate("Desc_OreCopper_C", "Copper Ore", 60, 60)],
        at: { x: -2290, y: 900 },
        siteKey: COPPER,
        loop: false,
      },
    ],
    edges: [
      { from: "Build_MinerMk2_C||1150|-400", to: "Build_SmelterMk1_C|Iron Ingot|1200|-400", kind: "belt", itemClassName: "Desc_OreIron_C", itemName: "Iron Ore", ratePerMinute: 120, rate: "measured", mixed: false, capacityPerMinute: 270, conveyorCount: 3 },
      { from: "Build_SmelterMk1_C|Iron Ingot|1200|-400", to: "Build_ConstructorMk1_C|Iron Plate|1250|-400", kind: "belt", itemClassName: "Desc_IronIngot_C", itemName: "Iron Ingot", ratePerMinute: 102.2, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 14 },
      { from: "Build_ConstructorMk1_C|Iron Plate Recycle|1260|-420", to: "Build_ConstructorMk1_C|Iron Plate|1250|-400", kind: "belt", itemClassName: "Desc_IronIngot_C", itemName: "Iron Ingot", ratePerMinute: 5.8, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 2 },
      { from: "Build_ConstructorMk1_C|Iron Plate|1250|-400", to: "Build_ConstructorMk1_C|Iron Plate Recycle|1260|-420", kind: "belt", itemClassName: "Desc_IronPlate_C", itemName: "Iron Plate", ratePerMinute: 4, rate: "measured", mixed: false, capacityPerMinute: 60, conveyorCount: 1 },
      { from: "Build_ConstructorMk1_C|Iron Plate|1250|-400", to: "Build_StorageContainerMk1_C||1300|-400", kind: "belt", itemClassName: "Desc_IronPlate_C", itemName: "Iron Plate", ratePerMinute: null, rate: "unknown", mixed: true, capacityPerMinute: null, conveyorCount: 4 },
      { from: "Build_MinerMk1_C||-2300|900", to: "Build_SmelterMk1_C|Copper Ingot|-2290|900", kind: "belt", itemClassName: "Desc_OreCopper_C", itemName: "Copper Ore", ratePerMinute: 60, rate: "measured", mixed: false, capacityPerMinute: 60, conveyorCount: 2 },
    ],
    sites: [
      {
        key: IRON,
        name: "Iron Plate site",
        at: { x: 1232, y: -403 },
        machineCount: 15,
        stateCounts: { producing: 12, underfed: 2 },
        topOutputs: [rate("Desc_IronPlate_C", "Iron Plate", 72, 160)],
        nodeKeys: [
          "Build_MinerMk2_C||1150|-400",
          "Build_SmelterMk1_C|Iron Ingot|1200|-400",
          "Build_ConstructorMk1_C|Iron Plate|1250|-400",
          "Build_ConstructorMk1_C|Iron Plate Recycle|1260|-420",
          "Build_StorageContainerMk1_C||1300|-400",
        ],
      },
      {
        key: COPPER,
        name: "Copper Ingot site",
        at: { x: -2293, y: 900 },
        machineCount: 3,
        stateCounts: { producing: 3 },
        topOutputs: [rate("Desc_CopperIngot_C", "Copper Ingot", 60, 60)],
        nodeKeys: ["Build_MinerMk1_C||-2300|900", "Build_SmelterMk1_C|Copper Ingot|-2290|900"],
      },
    ],
    unconnectedMachineIds: ["Build_AssemblerMk1_C_1"],
    beltData: "stale",
    connectionsRefreshMinutes: 10,
    notes: [CONNECTIONS_REFRESH],
  },
} satisfies ProductionGraphResponse;

/** An empty factory, or one the conveyors layer hasn't been read for yet. */
export const productionGraphEmpty = {
  serverId: "default",
  observedAt: "2026-10-23T15:05:00.000Z",
  stale: false,
  data: { nodes: [], edges: [], sites: [], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [CONNECTIONS_REFRESH] },
} satisfies ProductionGraphResponse;

/**
 * ADR-0055 Decision 9: the contract PR's new fields in one place. SYNTHETIC (no backend produces them yet). Two factories
 * (Iron Plate and Iron Rod) sharing one smelter group 60/40, an ore miner at a remote site joined to the main base by a
 * train into a depot, an overflow of rods to the sink (`excess`, destination `sink`) and plates into storage. Also uses
 * ADR-0053 Decision 5's `treeKey`, `resource`, `flow` and `itemFrom`.
 */
const MAIN = "site|0|0";
const REMOTE = "site|5000|5000";
const PLATE = "factory|Desc_IronPlate_C|1250|0";
const ROD = "factory|Desc_IronRod_C|1250|100";
const MINER = "Build_MinerMk2_C||5000|5000";
const DEPOT = "Build_TrainStation_C||0|0";
const SMELTER = "Build_SmelterMk1_C|Iron Ingot|1200|0";
const PLATE_CON = "Build_ConstructorMk1_C|Iron Plate|1250|0";
const ROD_CON = "Build_ConstructorMk1_C|Iron Rod|1250|100";
const STORE = "Build_StorageContainerMk1_C||1300|0";
const SINK = "Build_ResourceSink_C||1300|100";
const SHARED_60_40 = [
  { factoryKey: PLATE, share: 0.6 },
  { factoryKey: ROD, share: 0.4 },
];

const node = (
  key: string,
  kind: string,
  className: string,
  name: string,
  recipe: string | null,
  siteKey: string,
  at: { x: number; y: number },
  extra: Record<string, unknown> = {},
) => ({
  key,
  kind,
  className,
  name,
  recipe,
  count: 1,
  machineIds: [`${className}_1`],
  stateCounts: {},
  products: [],
  ingredients: [],
  at,
  siteKey,
  loop: false,
  ...extra,
});

export const productionGraphFactories = {
  serverId: "default",
  observedAt: "2026-10-24T12:00:00.000Z",
  stale: false,
  data: {
    nodes: [
      node(MINER, "extractor", "Build_MinerMk2_C", "Miner Mk.2", null, REMOTE, { x: 5000, y: 5000 }, {
        products: [rate("Desc_OreIron_C", "Iron Ore", 120, 120)],
        treeKey: "tree|Desc_OreIron_C|5000|5000",
        resource: { className: "Desc_OreIron_C", name: "Iron Ore" },
        factoryKey: PLATE,
        shares: SHARED_60_40,
      }),
      node(DEPOT, "station", "Build_TrainStation_C", "Main Depot", null, MAIN, { x: 0, y: 0 }, { role: "depot", factoryKey: PLATE, shares: SHARED_60_40 }),
      node(SMELTER, "machines", "Build_SmelterMk1_C", "Smelter", "Iron Ingot", MAIN, { x: 1200, y: 0 }, {
        count: 4,
        products: [rate("Desc_IronIngot_C", "Iron Ingot", 120, 120)],
        ingredients: [rate("Desc_OreIron_C", "Iron Ore", 120, 120)],
        treeKey: "tree|Desc_IronIngot_C|1200|0",
        factoryKey: PLATE,
        shares: SHARED_60_40,
        collapseUnder: DEPOT,
      }),
      node(PLATE_CON, "machines", "Build_ConstructorMk1_C", "Constructor", "Iron Plate", MAIN, { x: 1250, y: 0 }, {
        count: 4,
        products: [rate("Desc_IronPlate_C", "Iron Plate", 48, 80)],
        factoryKey: PLATE,
        collapseUnder: STORE,
      }),
      node(ROD_CON, "machines", "Build_ConstructorMk1_C", "Constructor", "Iron Rod", MAIN, { x: 1250, y: 100 }, {
        count: 2,
        products: [rate("Desc_IronRod_C", "Iron Rod", 30, 30)],
        factoryKey: ROD,
        collapseUnder: null,
      }),
      node(STORE, "storage", "Build_StorageContainerMk1_C", "Storage Container", null, MAIN, { x: 1300, y: 0 }, { role: "storage", factoryKey: PLATE }),
      node(SINK, "consumer", "Build_ResourceSink_C", "AWESOME Sink", null, MAIN, { x: 1300, y: 100 }, { role: "sink", factoryKey: ROD }),
    ],
    edges: [
      { from: DEPOT, to: SMELTER, kind: "belt", itemClassName: "Desc_OreIron_C", itemName: "Iron Ore", ratePerMinute: 120, rate: "estimated", mixed: false, capacityPerMinute: 270, conveyorCount: 6, flow: "supply", itemFrom: "upstream", destination: "factory" },
      { from: SMELTER, to: PLATE_CON, kind: "belt", itemClassName: "Desc_IronIngot_C", itemName: "Iron Ingot", ratePerMinute: 72, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 5, flow: "supply", itemFrom: "recipe", destination: "factory" },
      { from: SMELTER, to: ROD_CON, kind: "belt", itemClassName: "Desc_IronIngot_C", itemName: "Iron Ingot", ratePerMinute: 48, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 5, flow: "supply", itemFrom: "recipe", destination: "factory" },
      { from: PLATE_CON, to: STORE, kind: "belt", itemClassName: "Desc_IronPlate_C", itemName: "Iron Plate", ratePerMinute: 48, rate: "measured", mixed: false, capacityPerMinute: 120, conveyorCount: 2, flow: "output", destination: "storage" },
      { from: ROD_CON, to: SINK, kind: "belt", itemClassName: "Desc_IronRod_C", itemName: "Iron Rod", ratePerMinute: 6, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 2, flow: "excess", destination: "sink" },
    ],
    sites: [
      { key: MAIN, name: "Main base", at: { x: 900, y: 40 }, machineCount: 12, stateCounts: {}, topOutputs: [rate("Desc_IronPlate_C", "Iron Plate", 48, 80)], nodeKeys: [DEPOT, SMELTER, PLATE_CON, ROD_CON, STORE, SINK] },
      { key: REMOTE, name: "Site near (5000, 5000)", at: { x: 5000, y: 5000 }, machineCount: 1, stateCounts: { producing: 1 }, topOutputs: [rate("Desc_OreIron_C", "Iron Ore", 120, 120)], nodeKeys: [MINER] },
    ],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [CONNECTIONS_REFRESH],
    factories: [
      {
        key: PLATE,
        name: "Iron Plate factory",
        designationId: null,
        products: [rate("Desc_IronPlate_C", "Iron Plate", 48, 80)],
        sideProducts: [],
        nodeKeys: [MINER, DEPOT, SMELTER, PLATE_CON, STORE],
        siteKeys: [MAIN, REMOTE],
        machineCount: 9,
        sharedNodeCount: 3,
      },
      {
        key: ROD,
        name: "Iron Rod factory",
        designationId: null,
        products: [rate("Desc_IronRod_C", "Iron Rod", 30, 30)],
        sideProducts: ["Iron Rod"],
        nodeKeys: [ROD_CON, SINK],
        siteKeys: [MAIN],
        machineCount: 3,
        sharedNodeCount: 0,
      },
    ],
    transports: [
      { from: MINER, to: DEPOT, mode: "train", itemClassName: "Desc_OreIron_C", itemName: "Iron Ore", itemFrom: "resourceNode", ratePerMinute: 120, rate: "estimated", carriers: 2, routeName: "Ore Run", flow: "supply", destination: "factory" },
    ],
    topologyHash: "sha256-planner-factories-sample",
    logistics: "partial",
  },
} satisfies ProductionGraphResponse;

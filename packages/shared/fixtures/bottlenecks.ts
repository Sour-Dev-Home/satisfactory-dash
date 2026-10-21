import type { BottlenecksResponse } from "../src/index";

/**
 * ADR-0048 amendment (Decision 4): finder responses. The conveyor ids, tiers, capacities and positions, and the
 * constructor and refinery ids, are the 2026-10-21 captures' (see `conveyorsSample` in ./map.ts). The VERDICTS, items,
 * rates and the smelter and assembler ids are SYNTHETIC: no capture records what a belt carries or what a machine there
 * wants, and the finder (amendment PR 3) does not exist yet.
 */

const CONNECTIONS_REFRESH = { code: "connectionsRefresh", text: "Connections refresh every 10 minutes." };

/** Belt level ran. The constructor behind the miner and splitter wants 90 Limestone a minute (Concrete at 200 %) and the
 *  Mk.1 belt from the splitter caps it at 60; the refinery's Mk.1 lift caps its Petroleum Coke output. */
export const bottlenecksBeltLevel = {
  serverId: "default",
  observedAt: "2026-10-21T15:05:00.000Z",
  stale: false,
  data: {
    findings: [
      {
        buildingId: "Build_ConstructorMk1_C_2147002363",
        buildingName: "Constructor",
        state: "underfed",
        rootCause: {
          kind: "logistics",
          itemClassName: "Desc_Stone_C",
          itemName: "Limestone",
          supplyMaxPerMinute: 60,
          demandMaxPerMinute: 90,
          unit: "items/min",
          cappedBy: {
            conveyorId: "Build_ConveyorBeltMk1_C_2146995466",
            kind: "belt",
            tier: "Conveyor Belt Mk.1",
            capacityPerMinute: 60,
            fromId: "Build_ConveyorAttachmentSplitter_C_2146996403",
            toId: "Build_ConstructorMk1_C_2147002363",
            at: { x: -554, y: -1278 },
          },
        },
        chain: [],
        text: "A Conveyor Belt Mk.1 (60/min) from the splitter near (-554, -1278) caps Limestone at 60/min; this Constructor wants 90.",
      },
      {
        buildingId: "Build_OilRefinery_C_2146845148",
        buildingName: "Refinery",
        state: "backedUp",
        rootCause: {
          kind: "logistics",
          itemClassName: "Desc_PetroleumCoke_C",
          itemName: "Petroleum Coke",
          supplyMaxPerMinute: 120,
          demandMaxPerMinute: 60,
          unit: "items/min",
          cappedBy: {
            conveyorId: "Build_ConveyorLiftMk1_C_2146826510",
            kind: "lift",
            tier: "Conveyor Lift Mk.1",
            capacityPerMinute: 60,
            fromId: "Build_OilRefinery_C_2146845148",
            toId: "Build_ConveyorBeltMk3_C_2146694474",
            at: { x: -367, y: -1906 },
          },
        },
        chain: [],
        text: "A Conveyor Lift Mk.1 (60/min) near (-367, -1906) caps this Refinery's Petroleum Coke output at 60/min; it makes up to 120.",
      },
    ],
    truncated: false,
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [CONNECTIONS_REFRESH],
  },
} satisfies BottlenecksResponse;

/** Owner answer 3: an older FRM without the connection fields. Item-level results with a note to update FRM. The
 *  constructor's producer is itself unpowered, so the chain walks one step upstream to the terminal. */
export const bottlenecksItemLevelOldFrm = {
  serverId: "default",
  observedAt: "2026-10-21T15:05:00.000Z",
  stale: false,
  data: {
    findings: [
      {
        buildingId: "Build_ConstructorMk1_C_2147002363",
        buildingName: "Constructor",
        state: "underfed",
        rootCause: { kind: "unpowered", buildingId: "Build_SmelterMk1_C_2147002001" },
        chain: [
          {
            kind: "upstream",
            itemClassName: "Desc_IronIngot_C",
            itemName: "Iron Ingot",
            buildingId: "Build_SmelterMk1_C_2147002001",
            supplyMaxPerMinute: 30,
            demandMaxPerMinute: 30,
            unit: "items/min",
          },
          { kind: "unpowered", buildingId: "Build_SmelterMk1_C_2147002001" },
        ],
        text: "Its Iron Ingot comes from a Smelter that is unpowered.",
      },
      {
        buildingId: "Build_AssemblerMk1_C_2147003100",
        buildingName: "Assembler",
        state: "underfed",
        rootCause: {
          kind: "deficit",
          itemClassName: "Desc_Wire_C",
          itemName: "Wire",
          supplyMaxPerMinute: 120,
          demandMaxPerMinute: 180,
          unit: "items/min",
        },
        chain: [],
        text: "Wire is made at most 120/min and its consumers want 180/min.",
      },
    ],
    truncated: false,
    beltData: "unsupported",
    connectionsRefreshMinutes: 10,
    notes: [{ code: "updateFrm", text: "Item-level results only. Update FRM to 1.5.4 or newer for belt detail." }],
  },
} satisfies BottlenecksResponse;

/** Nothing underfed or backed up. */
export const bottlenecksEmpty = {
  serverId: "default",
  observedAt: "2026-10-21T15:05:00.000Z",
  stale: false,
  data: { findings: [], truncated: false, beltData: "present", connectionsRefreshMinutes: 10, notes: [CONNECTIONS_REFRESH] },
} satisfies BottlenecksResponse;

/** DEPLOY SKEW: a newer backend's step kind and note code this contract does not list still parse; the client shows the
 *  finding's `text` and the note's `text` only. */
export const bottlenecksUnknownKind = {
  serverId: "default",
  observedAt: "2026-10-21T15:05:00.000Z",
  stale: false,
  data: {
    findings: [
      {
        buildingId: "Build_ConstructorMk1_C_2147002363",
        buildingName: "Constructor",
        state: "underfed",
        rootCause: { kind: "filteredBySmartSplitter", itemClassName: "Desc_Stone_C", itemName: "Limestone" },
        chain: [],
        text: "A smart splitter upstream filters Limestone away from this Constructor.",
      },
    ],
    truncated: true,
    beltData: "stale",
    connectionsRefreshMinutes: 10,
    notes: [CONNECTIONS_REFRESH, { code: "someFutureNote", text: "A note a newer backend adds." }],
  },
} satisfies BottlenecksResponse;

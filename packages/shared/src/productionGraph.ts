import { z } from "zod";
import { BOTTLENECK_BELT_DATA_MODES, BottleneckNoteSchema } from "./bottlenecks";
import { snapshotEnvelope } from "./envelope";
import { ConveyorPointSchema } from "./map";

/**
 * ADR-0050 (production planner), Decision 1's contract: the whole factory as a coarse graph, built by the backend from
 * the latest factory snapshot and the stored conveyors layer, laid out by the browser. Additive (ADR-0007): a new
 * endpoint, nothing else changes. Every name is game-server text, rendered as text only.
 */

export const PLANNER_MAX_NODES = 5_000;
export const PLANNER_MAX_EDGES = 20_000;
export const PLANNER_MAX_MACHINE_IDS = 1_000;
export const PLANNER_MAX_SITES = 500;
export const PLANNER_MAX_RATES = 16;
/** ADR-0055 Decision 9. Factories are capped like sites; one transport per route, so far fewer than belt edges. */
export const PLANNER_MAX_FACTORIES = PLANNER_MAX_SITES;
export const PLANNER_MAX_TRANSPORTS = 2_000;
export const PLANNER_MAX_SHARES = 5;
export const PLANNER_MAX_SIDE_PRODUCTS = 8;

const Name = z.string().max(200);
const Id = z.string().min(1).max(128);
/** Rebuilt every read; valid for one response only (Decision 1, "stable keys without stored ids"). */
const Key = z.string().min(1).max(300);

export const KNOWN_PLANNER_NODE_KINDS = ["machines", "extractor", "storage", "station", "consumer", "other"] as const;
export type KnownPlannerNodeKind = (typeof KNOWN_PLANNER_NODE_KINDS)[number];

/** A summed rate over a group, as ProductionRate (ADR-0015 units). */
export const PlannerRateSchema = z.object({
  className: Name,
  name: Name,
  unit: z.enum(["items/min", "m3/min"]).nullable().optional().describe("ADR-0015; null or missing = unknown"),
  currentPerMinute: z.number().finite().min(0),
  maxPerMinute: z.number().finite().min(0),
});

export const KNOWN_PLANNER_NODE_ROLES = ["buffer", "storage", "depot", "sink", "power", "export"] as const;
export const KNOWN_PLANNER_FLOWS = ["supply", "excess", "output"] as const;
export const KNOWN_PLANNER_ITEM_FROM = ["recipe", "resourceNode", "upstream", "downstream"] as const;
export const KNOWN_PLANNER_TRANSPORT_MODES = ["train", "truck", "drone", "depot"] as const;
export const KNOWN_PLANNER_LOGISTICS = ["present", "partial", "notRead"] as const;

/** One factory's fraction of a shared node's design output. */
export const PlannerShareSchema = z.object({ factoryKey: Key, share: z.number().finite().min(0).max(1) });

export const PlannerNodeSchema = z.object({
  key: Key,
  kind: z
    .string()
    .min(1)
    .max(40)
    .describe(`Known: ${KNOWN_PLANNER_NODE_KINDS.join(", ")}. A plain string, so a newer kind never breaks an older parse.`),
  className: Name,
  name: Name,
  recipe: Name.nullable(),
  count: z.number().int().min(1),
  machineIds: z.array(Id).max(PLANNER_MAX_MACHINE_IDS).describe("This snapshot's ids, for the bottleneck link and the group panel"),
  stateCounts: z.record(z.string().max(40), z.number().int().min(0)),
  products: z.array(PlannerRateSchema).max(PLANNER_MAX_RATES).describe("Summed over the group; empty for an end without data"),
  ingredients: z.array(PlannerRateSchema).max(PLANNER_MAX_RATES),
  at: ConveyorPointSchema.describe("The group's centroid, whole metres"),
  siteKey: Key,
  loop: z.boolean().describe("Part of a cycle (a strongly connected component of more than one node)"),
  // ADR-0053 Decision 5 and ADR-0055 Decision 9: all optional, absent = an older backend. Plain strings with known
  // values, so a newer value never breaks an older frontend.
  treeKey: Key.optional().describe("The bubble; absent = the frontend groups by (kind, className, recipe) per site"),
  resource: z.object({ className: Name, name: Name }).nullable().optional().describe("An extractor's inferred item"),
  factoryKey: Key.optional().describe("The node's factory (its largest share); valid for one response only"),
  shares: z
    .array(PlannerShareSchema)
    .max(PLANNER_MAX_SHARES)
    .optional()
    .describe("Only when the node is shared between factories: its top design-rate shares"),
  collapseUnder: Key.nullable().optional().describe("Immediate post-dominator in its factory; null = none"),
  role: z.string().max(20).optional().describe(`Known: ${KNOWN_PLANNER_NODE_ROLES.join(", ")}`),
});

export const PlannerEdgeSchema = z.object({
  from: Key,
  to: Key,
  kind: z.enum(["belt", "pipe"]).describe("A lift counts as a belt"),
  itemClassName: Name.nullable().describe("null = could not be inferred (Decision 2)"),
  itemName: Name.nullable(),
  ratePerMinute: z.number().finite().min(0).nullable(),
  rate: z.enum(["measured", "estimated", "unknown"]).describe("measured only with a single source; never presented as more"),
  mixed: z.boolean().describe("The pass-through component carries more than one solid item"),
  capacityPerMinute: z.number().finite().min(0).nullable().describe("Only for an unbranched chain (its slowest tier); else null"),
  conveyorCount: z.number().int().min(0),
  flow: z.string().max(20).optional().describe(`ADR-0053. Known: ${KNOWN_PLANNER_FLOWS.join(", ")}; absent = supply`),
  itemFrom: z.string().max(20).optional().describe(`ADR-0053. How an inferred item was found. Known: ${KNOWN_PLANNER_ITEM_FROM.join(", ")}`),
  destination: z.string().max(20).optional().describe("ADR-0055 Decision 3: where the flow ends (storage, sink, export, ...); a plain string"),
});

/** ADR-0055 Decision 2: one logical edge per transport route. Its own array, since `PlannerEdge.kind` is a closed enum. */
export const PlannerTransportSchema = z.object({
  from: Key,
  to: Key,
  mode: z.string().min(1).max(20).describe(`Known: ${KNOWN_PLANNER_TRANSPORT_MODES.join(", ")}`),
  itemClassName: Name.nullable(),
  itemName: Name.nullable(),
  itemFrom: z.string().max(20).optional(),
  ratePerMinute: z.number().finite().min(0).nullable(),
  rate: z.enum(["measured", "estimated", "unknown"]),
  carriers: z.number().int().min(0),
  routeName: Name.nullable().describe("Game text, rendered as text only"),
  flow: z.string().max(20).optional(),
  destination: z.string().max(20).optional(),
});

/** ADR-0055 Decision 4: a logical factory, derived every read (or named by a designation, later PR). */
export const PlannerFactorySchema = z.object({
  key: Key,
  name: Name,
  designationId: z.uuid().nullable().describe("null = automatic"),
  products: z.array(PlannerRateSchema).max(PLANNER_MAX_RATES),
  sideProducts: z.array(Name).max(PLANNER_MAX_SIDE_PRODUCTS),
  nodeKeys: z.array(Key).max(PLANNER_MAX_NODES),
  siteKeys: z.array(Key).max(PLANNER_MAX_SITES),
  machineCount: z.number().int().min(0),
  sharedNodeCount: z.number().int().min(0),
});

/** Decision 8: computed every read (components merged within a distance), named by default, keyed for UI state only. */
export const PlannerSiteSchema = z.object({
  key: Key,
  name: z.string().min(1).max(200).describe('"Computer site" or "Site near (x, y)"'),
  at: ConveyorPointSchema.describe("Centroid, whole metres"),
  machineCount: z.number().int().min(0),
  stateCounts: z.record(z.string().max(40), z.number().int().min(0)),
  topOutputs: z.array(PlannerRateSchema).max(5).describe("The site's most downstream products, actual over max"),
  nodeKeys: z.array(Key).max(PLANNER_MAX_NODES),
});

export const ProductionGraphSchema = z.object({
  nodes: z.array(PlannerNodeSchema).max(PLANNER_MAX_NODES),
  edges: z.array(PlannerEdgeSchema).max(PLANNER_MAX_EDGES),
  sites: z.array(PlannerSiteSchema).max(PLANNER_MAX_SITES),
  unconnectedMachineIds: z.array(Id).max(20_000).describe("Machines no conveyor names yet (beltData stale)"),
  beltData: z.enum(BOTTLENECK_BELT_DATA_MODES),
  connectionsRefreshMinutes: z.number().int().min(1).max(1440),
  notes: z.array(BottleneckNoteSchema).max(8),
  factories: z.array(PlannerFactorySchema).max(PLANNER_MAX_FACTORIES).optional(),
  transports: z.array(PlannerTransportSchema).max(PLANNER_MAX_TRANSPORTS).optional(),
  topologyHash: z.string().max(64).optional().describe("Hash of everything the reduction depends on; a layout memo key"),
  logistics: z.string().max(20).optional().describe(`Known: ${KNOWN_PLANNER_LOGISTICS.join(", ")}`),
});

export const ProductionGraphResponseSchema = snapshotEnvelope(ProductionGraphSchema);

export type PlannerRate = z.infer<typeof PlannerRateSchema>;
export type PlannerNode = z.infer<typeof PlannerNodeSchema>;
export type PlannerEdge = z.infer<typeof PlannerEdgeSchema>;
export type PlannerShare = z.infer<typeof PlannerShareSchema>;
export type PlannerTransport = z.infer<typeof PlannerTransportSchema>;
export type PlannerFactory = z.infer<typeof PlannerFactorySchema>;
export type PlannerSite =z.infer<typeof PlannerSiteSchema>;
export type ProductionGraph = z.infer<typeof ProductionGraphSchema>;
export type ProductionGraphResponse = z.infer<typeof ProductionGraphResponseSchema>;

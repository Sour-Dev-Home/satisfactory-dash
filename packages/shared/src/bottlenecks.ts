import { z } from "zod";
import { snapshotEnvelope } from "./envelope";
import { ConveyorKindSchema, ConveyorPointSchema } from "./map";

/**
 * ADR-0048 (#349) and its 2026-10-21 amendment, Decision 4: the bottleneck finder's response. The backend walks from an
 * underfed or backed-up machine to a root cause over two graphs joined by building id: the item graph from the factory
 * snapshot and the connection graph from the `conveyors` world layer (map.ts). Deterministic (ground rule 3): every
 * number and sentence here is computed, never generated.
 *
 * Contract only (amendment PR 1). The finder (PR 3) and the route (PR 4) come later and the Factory page section (PR 5)
 * waits for G-B1 and G-B2, so nothing reads or serves this yet.
 */

/** Top N of the Factory page's "Bottlenecks" section (owner answer 2: top 10), and the most a request may ask for. */
export const BOTTLENECKS_DEFAULT_LIMIT = 10;
export const BOTTLENECKS_MAX_LIMIT = 50;
/** The upstream (or downstream) walk stops at this depth. */
export const BOTTLENECK_CHAIN_MAX_STEPS = 8;

/**
 * A step's verdict. Upstream, for an underfed machine, in rank order: `noProducer` (nothing in the factory makes the
 * item), `notConnected` (nothing upstream of the machine's inputs makes it, and no extractor, storage or station is
 * upstream either), `deficit` (the producers that can reach the machine make less than their consumers want),
 * `upstream` (a producer is itself short; `unpowered`, `paused` and `idle` are its terminals), `logistics` (supply is
 * enough; with `cappedBy` a conveyor caps it, without it the data cannot say why). `loop` ends a walk at an item already
 * seen. Downstream, for a backed-up machine: `noConsumer`, `surplus`, `downstream` and `logistics`.
 */
export const KNOWN_BOTTLENECK_STEP_KINDS = [
  "noProducer",
  "notConnected",
  "deficit",
  "upstream",
  "logistics",
  "unpowered",
  "paused",
  "idle",
  "loop",
  "noConsumer",
  "surplus",
  "downstream",
] as const;
export type KnownBottleneckStepKind = (typeof KNOWN_BOTTLENECK_STEP_KINDS)[number];

/** The conveyor on the min cut that caps the flow (the residual-reachable cut, lowest capacity first, then id). A cut
 *  always has a trusted capacity, so `capacityPerMinute` is never null here, unlike a conveyors-layer edge's (a pipe
 *  with no trusted capacity can block a path, never cap it). */
export const BottleneckCappedBySchema = z.object({
  conveyorId: z.string().min(1).max(128),
  kind: ConveyorKindSchema,
  tier: z.string().min(1).max(64).describe('The tier\'s display name, e.g. "Conveyor Belt Mk.1"'),
  capacityPerMinute: z.number().finite().min(0),
  fromId: z.string().min(1).max(128).nullable().describe("The id at the conveyor's end 0; null = open end"),
  toId: z.string().min(1).max(128).nullable().describe("The id at the conveyor's end 1; null = open end"),
  at: ConveyorPointSchema.describe('End 0\'s position, whole metres, for "near (x, y)"'),
});

export const BottleneckStepSchema = z.object({
  kind: z
    .string()
    .min(1)
    .max(40)
    .describe(
      `Known: ${KNOWN_BOTTLENECK_STEP_KINDS.join(", ")}. A plain string, not an enum, so an older frontend still parses a ` +
        "newer backend's kind and shows the finding's `text` only (ADR-0048).",
    ),
  itemClassName: z.string().max(200).optional(),
  itemName: z.string().max(200).optional(),
  buildingId: z.string().max(128).optional().describe("The producer or consumer this step points at"),
  supplyMaxPerMinute: z.number().finite().min(0).optional(),
  demandMaxPerMinute: z.number().finite().min(0).optional(),
  unit: z.enum(["items/min", "m3/min"]).nullable().optional().describe("ADR-0015; null or missing = unknown"),
  cappedBy: BottleneckCappedBySchema.optional().describe("On `logistics` only: the conveyor that caps the flow"),
});

/** How many of a cause's machines a finding lists (#592); `affectedCount` says how many there are in all. */
export const BOTTLENECK_AFFECTED_MAX = 50;

/** One machine a cause affects, named the way a player finds it: class, recipe and about where (#592). */
export const BottleneckMachineSchema = z.object({
  buildingId: z.string().min(1).max(128),
  buildingName: z.string().max(200),
  recipe: z.string().max(200).nullable(),
  at: ConveyorPointSchema.optional().describe('Whole metres, for "near (x, y)"; missing when the building has no position'),
});

/**
 * For a `deficit` root (#592): the item's most common producer (class and recipe) and how many more of it would cover
 * the gap. `perMachinePerMinute` is one machine's rated output at 100% clock; `machines` rounds the gap up.
 */
export const BottleneckFixSchema = z.object({
  producerName: z.string().max(200),
  recipe: z.string().max(200).nullable(),
  perMachinePerMinute: z.number().finite().positive(),
  machines: z.number().int().min(1).max(100_000),
  unit: z.enum(["items/min", "m3/min"]).nullable().optional(),
});

/**
 * One root cause (#592: the backend groups machines that share one): the representative machine (the one losing the
 * most output), the cause, and the machines it affects. The fields after `text` are optional so a newly deployed
 * frontend still parses an older backend's findings, which are one per machine.
 */
export const BottleneckSchema = z.object({
  buildingId: z.string().min(1).max(128),
  buildingName: z.string().max(200),
  state: z.enum(["underfed", "backedUp"]),
  rootCause: BottleneckStepSchema.describe("The ranked terminal verdict"),
  chain: z.array(BottleneckStepSchema).max(BOTTLENECK_CHAIN_MAX_STEPS),
  text: z.string().min(1).max(500).describe("One deterministic sentence built by the backend"),
  recipe: z.string().max(200).nullable().optional().describe("The representative machine's recipe"),
  at: ConveyorPointSchema.optional().describe("The representative machine's position, whole metres"),
  affectedCount: z.number().int().min(1).optional().describe("How many machines share this root cause, this one included"),
  affected: z.array(BottleneckMachineSchema).max(BOTTLENECK_AFFECTED_MAX).optional().describe("The first of them, most output lost first"),
  fix: BottleneckFixSchema.optional(),
});

/**
 * Which mode the finder ran in (amendment, Decisions 2 and 3, owner answers 3 and 4):
 * - `present`: belt level, the conveyors layer is fresh enough to join.
 * - `stale`: belt level, but some machines are on no conveyor yet (built since the last read) and fell back to item level.
 * - `unsupported`: item level only; the server's FRM has no connection fields (older than 1.5.4).
 * - `tooLarge`: item level only; the conveyors layer passed the 2 MB world-layer cap and was skipped (ADR-0038).
 * - `notReceived`: item level only; the backend has no usable conveyors layer from the agent yet (never sent, or an agent
 *   built before the layer existed). Says nothing about FRM. Additive (ADR-0007): an older client treats it as unknown.
 */
export const BOTTLENECK_BELT_DATA_MODES = ["present", "stale", "unsupported", "tooLarge", "notReceived"] as const;

/** Every note code the backend emits, on the bottlenecks section and the planner's production graph (which reuses this
 *  note shape). The list documents; it does not restrict: `code` stays a free string, so a new note never breaks a parse.
 *  - `connectionsRefresh`: "connections refresh every 10 minutes" (owner answer 4; bottlenecks whenever the belt level
 *    ran, the production graph when `beltData` is `stale`).
 *  - `updateFrm`: item level only / no graph; update FRM to 1.5.4 or newer for belt detail (`beltData: "unsupported"`).
 *  - `beltDataTooLarge`: the belt and pipe data passed the world-layer cap (`beltData: "tooLarge"`).
 *  - `beltDataNotReceived`: the agent has not sent belt data yet and may need updating (`beltData: "notReceived"`).
 *  - `unmatchedLinks` (production graph): some links carry items their destination does not use (mixed belt, filter, overflow).
 *  - `graphTruncated` (production graph): the factory passed the graph's caps; the smallest sites, groups and links were left out.
 *  - `duplicateStationName` (production graph): two train stations share a name, so no train route is drawn through it.
 *  - `unknownTimetableStop` (production graph): a timetable names a station that does not exist; no route is drawn through it.
 *  - `staleConveyorEnds` (production graph): machines on the conveyor data are missing from the latest factory read; the
 *    conveyor data is older and refreshes within 10 minutes (sooner once the building set changes). */
export const KNOWN_BOTTLENECK_NOTE_CODES = [
  "connectionsRefresh",
  "updateFrm",
  "beltDataTooLarge",
  "beltDataNotReceived",
  "unmatchedLinks",
  "graphTruncated",
  "duplicateStationName",
  "unknownTimetableStop",
  "staleConveyorEnds",
] as const;
export type KnownBottleneckNoteCode = (typeof KNOWN_BOTTLENECK_NOTE_CODES)[number];

export const BottleneckNoteSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(40)
    .describe(`Known: ${KNOWN_BOTTLENECK_NOTE_CODES.join(", ")}. A plain string, so a new note never breaks a parse.`),
  text: z.string().min(1).max(300).describe("The note's sentence, built by the backend; the client shows it as is"),
});

export const BottlenecksSchema = z.object({
  findings: z.array(BottleneckSchema).max(BOTTLENECKS_MAX_LIMIT),
  truncated: z.boolean().describe("true = there were more root causes than `limit` (more machines, from an older backend)"),
  beltData: z.enum(BOTTLENECK_BELT_DATA_MODES),
  /** How often the connection graph is re-read (ADR-0038's world tier), for the "refresh every N minutes" note. */
  connectionsRefreshMinutes: z.number().int().min(1).max(1440),
  notes: z.array(BottleneckNoteSchema).max(8),
});

/** GET /api/servers/:serverId/bottlenecks?limit=10. `limit` is 1 to 50, default 10. */
export const BottlenecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(BOTTLENECKS_MAX_LIMIT).default(BOTTLENECKS_DEFAULT_LIMIT),
});

export const BottlenecksResponseSchema = snapshotEnvelope(BottlenecksSchema);

export type BottleneckCappedBy = z.infer<typeof BottleneckCappedBySchema>;
export type BottleneckStep = z.infer<typeof BottleneckStepSchema>;
export type Bottleneck = z.infer<typeof BottleneckSchema>;
export type BottleneckMachine = z.infer<typeof BottleneckMachineSchema>;
export type BottleneckFix = z.infer<typeof BottleneckFixSchema>;
export type BottleneckBeltData = (typeof BOTTLENECK_BELT_DATA_MODES)[number];
export type BottleneckNote = z.infer<typeof BottleneckNoteSchema>;
export type Bottlenecks = z.infer<typeof BottlenecksSchema>;
export type BottlenecksQuery = z.input<typeof BottlenecksQuerySchema>;
export type BottlenecksResponse = z.infer<typeof BottlenecksResponseSchema>;

import type { z } from "zod";
import { CONVEYORS_MAX_EDGES } from "@satisfactory-dash/shared";
import type { ConveyorEdge, ConveyorKind, ConveyorNodeKind } from "@satisfactory-dash/shared";
import { RawFrmConveyorSchema } from "../rawSchemas.js";
import { toWholeMetres, inWholeMetreBounds } from "./coordinates.js";

type RawConveyor = z.infer<typeof RawFrmConveyorSchema>;

/** The longest id / tier name the contract accepts (ConveyorEdgeSchema); a longer one drops the record. */
const MAX_ID_LENGTH = 128;
const MAX_TIER_LENGTH = 64;

export interface MappedConveyors {
  /** The edges, sorted by `id`. Always `[]` when `skip` is set; callers must check `skip` first and send nothing. */
  data: ConveyorEdge[];
  /** Records skipped: not the lenient shape (no id/name/position, an id over the contract's length, a position out of
   *  bounds), or without both `ConnectedTo` fields while others have them. The agent's conform-don't-reject rule. */
  dropped: number;
  /** Set when there is NO conveyors layer to send this cycle (ADR-0048 amendment, Decision 2): `unsupportedFrm` is the version
   *  gate (an FRM older than 1.5.4 returns no `ConnectedTo0`/`ConnectedTo1`; the finder runs item level only), `tooManyEdges`
   *  is over `CONVEYORS_MAX_EDGES` (skipped as ADR-0038 says, the backend keeps its last good copy). */
  skip?: "unsupportedFrm" | "tooManyEdges";
}

/** The three raw responses of one cycle, read back to back, as the unvalidated arrays FRM returned. */
export interface RawConveyorResponses {
  belts: readonly unknown[];
  lifts: readonly unknown[];
  pipes: readonly unknown[];
}

/**
 * Types one conveyor end from the class in its id (`Build_<Class>_C_<number>`, the same ids getFactory returns;
 * ADR-0048 amendment, Decision 3). Splitters and mergers are matched first so a "SplitterSmartLift" is a splitter, not a
 * lift. An unrecognised class is `other`, never a dropped edge.
 */
export function classifyConveyorEnd(id: string): ConveyorNodeKind {
  const cls = id.replace(/_\d+$/, "");
  if (/^Build_ConveyorAttachmentSplitter/.test(cls)) return "splitter";
  if (/^Build_ConveyorAttachmentMerger/.test(cls)) return "merger";
  if (/^Build_(ConveyorBelt|ConveyorLift|Pipeline_C$|PipelineMK2_C$)/i.test(cls)) return "conveyor";
  if (/^Build_Pipeline(Junction|Pump)/.test(cls)) return "junction";
  if (/^Build_(Miner|WaterPump|OilPump|Frack)/.test(cls)) return "extractor";
  if (/^Build_(Generator|ResourceSink|SpaceElevator)/.test(cls)) return "consumer";
  if (/^Build_(StorageContainer|CentralStorage|IndustrialTank|PipeStorage|FluidBuffer)/.test(cls)) return "storage";
  if (/^Build_(TrainDockingStation|TrainStation|DroneStation|TruckStation)/.test(cls)) return "station";
  if (/^Build_(Constructor|Assembler|Manufacturer|Smelter|Foundry|Packager|OilRefinery|Blender|HadronCollider|Converter|QuantumEncoder)/.test(cls)) {
    return "machine";
  }
  return "other";
}

function endOf(connectedTo: string): { id: string | null; kind: ConveyorNodeKind | null } {
  return connectedTo === "" ? { id: null, kind: null } : { id: connectedTo, kind: classifyConveyorEnd(connectedTo) };
}

/**
 * Projects one raw belt, lift or pipe into the contract's `ConveyorEdge`, or `undefined` if it cannot be (a missing
 * connection field, an over-long id, an out-of-bounds position). End 0 is `from`, end 1 is `to` (belts and lifts are
 * oriented that way, pipes are not: the finder reads a pipe as an arc each way). `at` is end 0's position in whole
 * metres. `capacityPerMinute` is the tier's rated speed, never live flow: items/min for belts and lifts, m³/min for pipes
 * (`Speed` is m³/s, G-B2). Ids are only good within one read: a rebuilt conveyor gets a new one (G-B1).
 */
export function mapConveyor(raw: RawConveyor, kind: ConveyorKind): ConveyorEdge | undefined {
  if (raw.ConnectedTo0 === undefined || raw.ConnectedTo1 === undefined) return undefined;
  if (raw.ID.length > MAX_ID_LENGTH || raw.ConnectedTo0.length > MAX_ID_LENGTH || raw.ConnectedTo1.length > MAX_ID_LENGTH) return undefined;
  const x = toWholeMetres(raw.location0.x);
  const y = toWholeMetres(raw.location0.y);
  if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y)) return undefined;
  const speed = kind === "pipe" ? (raw.Speed === undefined ? undefined : raw.Speed * 60) : raw.ItemsPerMinute;
  const from = endOf(raw.ConnectedTo0);
  const to = endOf(raw.ConnectedTo1);
  return {
    id: raw.ID,
    kind,
    from: from.id,
    fromKind: from.kind,
    to: to.id,
    toKind: to.kind,
    capacityPerMinute: speed === undefined || !Number.isFinite(speed) || speed < 0 ? null : speed,
    tier: raw.Name.slice(0, MAX_TIER_LENGTH),
    at: { x, y },
  };
}

/** Code-point order, not locale order: the same bytes on every machine, so the hash is stable. */
function byId(a: ConveyorEdge, b: ConveyorEdge): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * ADR-0048 amendment (PR 2), Decision 2: projects the three conveyor responses of one cycle into the conveyors layer.
 * Edges are sorted by `id` (and `at` is whole metres), so the agent's content hash only changes when the factory does.
 * No layer (`skip`) when no record carries `ConnectedTo0`/`ConnectedTo1` (FRM older than 1.5.4) or the result is over
 * `CONVEYORS_MAX_EDGES`.
 */
export function mapConveyors(raw: RawConveyorResponses): MappedConveyors {
  const parsed: { record: RawConveyor; kind: ConveyorKind }[] = [];
  let dropped = 0;
  const groups: [readonly unknown[], ConveyorKind][] = [
    [raw.belts, "belt"],
    [raw.lifts, "lift"],
    [raw.pipes, "pipe"],
  ];
  for (const [items, kind] of groups) {
    for (const item of items) {
      const result = RawFrmConveyorSchema.safeParse(item);
      if (result.success) parsed.push({ record: result.data, kind });
      else dropped++;
    }
  }

  // The version gate looks at the fields, not at a version number: with records present and none carrying both ends.
  const anyConnections = parsed.some(({ record }) => record.ConnectedTo0 !== undefined && record.ConnectedTo1 !== undefined);
  if (parsed.length > 0 && !anyConnections) return { data: [], dropped, skip: "unsupportedFrm" };
  // Records came back but every one was unreadable (a changed response shape): not an empty factory. Sending `[]` would
  // overwrite the backend's last good copy, so there is no layer this cycle.
  if (parsed.length === 0 && dropped > 0) return { data: [], dropped, skip: "unsupportedFrm" };

  const data: ConveyorEdge[] = [];
  for (const { record, kind } of parsed) {
    const edge = mapConveyor(record, kind);
    if (edge === undefined) dropped++;
    else data.push(edge);
  }
  if (data.length > CONVEYORS_MAX_EDGES) return { data: [], dropped, skip: "tooManyEdges" };
  data.sort(byId);
  return { data, dropped };
}

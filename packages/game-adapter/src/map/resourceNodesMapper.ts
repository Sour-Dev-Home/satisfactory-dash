import type { z } from "zod";
import type { ResourceNode } from "@satisfactory-dash/shared";
import type { RawFrmResourceNodeSchema } from "../rawSchemas.js";
import { toWholeMetres } from "./coordinates.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawResourceNode = z.infer<typeof RawFrmResourceNodeSchema>;

/** FRM's NodeType, camelCased, per the M1 contract's `nodeType` (#352 follow-up). An unrecognized
 *  future NodeType passes through unchanged rather than throwing: the contract's `nodeType` is a
 *  plain string (deploy skew, map.ts), and a gap in this lookup should never fail a whole ingest. */
const NODE_TYPE_CAMEL_CASE: Readonly<Record<string, string>> = {
  Node: "node",
  "Fracking Satellite": "frackingSatellite",
};

/**
 * ADR-0038 M2: projects one getResourceNode item into the M1 contract's ResourceNode
 * (packages/shared/src/map.ts). `type` is FRM's `Name` (the resource, e.g. "Iron Ore"); `purity`
 * is FRM's own `Purity` field ("Normal"/"Impure"/"Pure"), lowercased — not the separate
 * `EnumPurity` field (RP_Normal/RP_Inpure/RP_Pure), which has a typo ("Inpure") `Purity` doesn't.
 */
export function mapResourceNode(raw: RawResourceNode): ResourceNode {
  return {
    type: raw.Name,
    purity: raw.Purity.toLowerCase(),
    nodeType: NODE_TYPE_CAMEL_CASE[raw.NodeType] ?? raw.NodeType,
    x: toWholeMetres(raw.location.x),
    y: toWholeMetres(raw.location.y),
    exploited: raw.Exploited,
  };
}

export function mapResourceNodes(raw: readonly RawResourceNode[]): ResourceNode[] {
  return raw.map(mapResourceNode);
}

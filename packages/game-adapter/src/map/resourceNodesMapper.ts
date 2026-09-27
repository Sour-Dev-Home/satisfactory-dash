import type { z } from "zod";
import type { ResourceNode } from "@satisfactory-dash/shared";
import type { RawFrmResourceNodeSchema } from "../rawSchemas.js";
import { toWholeMetres, inWholeMetreBounds } from "./coordinates.js";
import { mapNodeType } from "./nodeType.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawResourceNode = z.infer<typeof RawFrmResourceNodeSchema>;

export interface MappedResourceNodes {
  data: ResourceNode[];
  /** Items skipped because a coordinate wasn't finite or fell outside the M1 contract's
   *  WholeMetreSchema bound (±1,000,000 m) — the agent's own conform-don't-reject rule
   *  (docs-vault/wiki/runbooks/agent-app.md): a bad item is dropped, never sent, rather than
   *  failing the whole layer. M3/M4 log this at warn. */
  dropped: number;
}

/**
 * ADR-0038 M2 (architect follow-up on #367): projects one getResourceNode item into the M1
 * contract's ResourceNode (packages/shared/src/map.ts), or `undefined` if a coordinate is bad.
 * `type` is FRM's `Name`; `purity` is FRM's own `Purity` field ("Normal"/"Impure"/"Pure"),
 * lowercased — not the separate `EnumPurity` field, which has a typo ("Inpure") `Purity` doesn't.
 */
export function mapResourceNode(raw: RawResourceNode): ResourceNode | undefined {
  const x = toWholeMetres(raw.location.x);
  const y = toWholeMetres(raw.location.y);
  if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y)) return undefined;
  return {
    type: raw.Name,
    purity: raw.Purity.toLowerCase(),
    nodeType: mapNodeType(raw.NodeType),
    x,
    y,
    exploited: raw.Exploited,
  };
}

export function mapResourceNodes(raw: readonly RawResourceNode[]): MappedResourceNodes {
  const data: ResourceNode[] = [];
  let dropped = 0;
  for (const item of raw) {
    const mapped = mapResourceNode(item);
    if (mapped === undefined) {
      dropped++;
    } else {
      data.push(mapped);
    }
  }
  return { data, dropped };
}

import type { ResourceNode } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import { countByType, countOf, formatPoint, nodeKindLabel, nodeRadiusPx, purityLabel } from "./worldGeometry";

/** Nodes are landmarks: FICSIT amber, small (ADR-0041). In use is filled, free is an outline. */
export const NODE_TOKEN = "--color-accent";
const NODE_WEIGHT_PX = 1.5;
/** An outline's fill opacity is 0; a filled marker's is solid. */
const FILLED_OPACITY = 1;

/** The tooltip as DOM text nodes: a resource's name comes from the game server, so it never goes through HTML. */
function tooltip(node: ResourceNode): HTMLElement {
  const box = document.createElement("div");
  const line = (text: string, strong = false) => {
    const el = document.createElement(strong ? "strong" : "div");
    el.textContent = text;
    box.append(el);
  };
  line(node.type, true);
  line(`${purityLabel(node.purity)} · ${nodeKindLabel(node.nodeType)}`);
  line(node.exploited ? "In use" : "Free");
  line(formatPoint([node.x, node.y]));
  return box;
}

/**
 * ADR-0038 M5, the base map's resource nodes (nodes, fracking satellites and geysers, one `resourceNodes`
 * world layer): a circle per node. Size is the purity (impure small, pure large) and the fill is whether
 * a miner uses it, so neither relies on colour alone; the resource's name is in the tooltip and the text.
 */
export const resourceNodesLayer: MapLayer<ResourceNode[]> = {
  id: "resourceNodes",
  label: "Resource nodes",
  defaultVisible: true,

  draw({ L, map, project, renderer, color }, nodes) {
    const group = L.layerGroup();
    const stroke = color(NODE_TOKEN);
    for (const node of nodes) {
      L.circleMarker(project(node.x, node.y), {
        renderer,
        radius: nodeRadiusPx(node.purity),
        color: stroke,
        weight: NODE_WEIGHT_PX,
        fillColor: stroke,
        fillOpacity: node.exploited ? FILLED_OPACITY : 0,
      })
        .bindTooltip(() => tooltip(node), { direction: "top", offset: [0, -nodeRadiusPx(node.purity)] })
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="size-4 flex-none">
          <circle cx="8" cy="8" r="5" className="fill-accent stroke-accent" strokeWidth="1.5" />
        </svg>
        In use (filled)
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="size-4 flex-none">
          <circle cx="8" cy="8" r="5" className="fill-none stroke-accent" strokeWidth="1.5" />
        </svg>
        Free (outline)
      </li>
      <li>Size: impure, normal, pure (small to large)</li>
    </ul>
  ),

  describe(nodes) {
    if (nodes.length === 0) return "No resource nodes read yet.";
    const used = nodes.filter((n) => n.exploited).length;
    const byType = countByType(nodes)
      .map(([type, n]) => `${n} ${type}`)
      .join(", ");
    return `${countOf(nodes.length, "resource node", "resource nodes")} on the map (${used} in use): ${byType}.`;
  },
};

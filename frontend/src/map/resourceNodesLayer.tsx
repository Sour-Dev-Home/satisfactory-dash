import type { ResourceNode } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import { countByType, countOf, formatPoint, nodeKindLabel, nodeRadiusPx, PURITY_RADIUS_PX, purityLabel } from "./worldGeometry";

/** Nodes have their own token (index.css), apart from the brand accent and the state colours. In use is filled, free is an outline. */
export const NODE_TOKEN = "--color-node";
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

/** A legend sample: a circle at the drawn radius (viewBox units are pixels), filled or an outline. */
function Dot({ r, filled }: { r: number; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-6 flex-none">
      <circle
        cx="12"
        cy="12"
        r={r}
        strokeWidth={NODE_WEIGHT_PX}
        className={filled ? "fill-node stroke-node" : "fill-none stroke-node"}
      />
    </svg>
  );
}

/**
 * ADR-0038 M5, the base map's resource nodes (nodes, fracking satellites and geysers, one `resourceNodes`
 * world layer): a circle per node. Size is the purity (impure small, pure large) and the fill is whether
 * a miner uses it, so neither relies on colour alone; every resource is one colour, and the resource's
 * name is in the tooltip and the text.
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
    <div className="grid gap-1 text-sm text-muted">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.normal} filled />
          In use (filled)
        </li>
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.normal} filled={false} />
          Free (outline)
        </li>
      </ul>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.impure} filled={false} />
          Impure
        </li>
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.normal} filled={false} />
          Normal
        </li>
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.pure} filled={false} />
          Pure
        </li>
      </ul>
      <p>One colour for every resource: the type is in the tooltip and the table below.</p>
    </div>
  ),

  describe(nodes) {
    if (nodes.length === 0) return "No resource nodes reported by the server.";
    const used = nodes.filter((n) => n.exploited).length;
    const byType = countByType(nodes)
      .map(([type, n]) => `${n} ${type}`)
      .join(", ");
    return `${countOf(nodes.length, "resource node", "resource nodes")} on the map (${used} in use): ${byType}.`;
  },
};

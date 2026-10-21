import type * as Leaflet from "leaflet";
import type { ResourceNode } from "@satisfactory-dash/shared";
import type { MapContext, MapLayer } from "./layers";
import { resourceIconUrl } from "./resourceIcons";
import { countByType, countOf, formatPoint, nodeKindLabel, nodeRadiusPx, PURITY_RADIUS_PX, purityLabel } from "./worldGeometry";

/** Nodes have their own token (index.css), apart from the brand accent and the state colours. For the fallback circle, in use is filled and free is an outline. */
export const NODE_TOKEN = "--color-node";
const NODE_WEIGHT_PX = 1.5;
/** An outline's fill opacity is 0; a filled marker's is solid. */
const FILLED_OPACITY = 1;

/** The icon's drawn size is a token per purity (index.css), the same one the CSS sizes it by; the tooltip clears half of it. */
const purityKey = (purity: string) => (purity === "impure" || purity === "pure" ? purity : "normal");
const iconSizePx = (token: (name: string) => string, purity: string) =>
  Number.parseFloat(token(`--spacing-node-icon-${purityKey(purity)}`)) || 0;

/** A node's icon as a DOM element (not an HTML string): the ring (in use) or the fade (free) is CSS on the marker. */
function iconMarker(L: MapContext["L"], url: string, node: ResourceNode) {
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.draggable = false;
  const purity = purityKey(node.purity);
  return L.divIcon({
    html: img,
    // The size and its centring are CSS (.node-icon), so the size is one token, not a number here too.
    iconSize: null as unknown as Leaflet.PointExpression,
    className: `node-icon node-icon-${purity} ${node.exploited ? "node-icon-used" : "node-icon-free"}`,
  });
}

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

/** A legend sample of the icon, in use (ringed) or free (faded): the same classes the map's markers carry. */
function Sample({ used }: { used: boolean }) {
  return (
    <img
      src={resourceIconUrl("Iron Ore", "node")}
      alt=""
      className={`size-6 flex-none ${used ? "node-icon-used" : "node-icon-free"}`}
    />
  );
}

/**
 * ADR-0038 M5, the base map's resource nodes (nodes, fracking satellites and geysers, one `resourceNodes`
 * world layer): the resource's game icon per node (#571), or a circle when the type is unknown. Size is
 * the purity (impure small, pure large) and in use is a ring round the icon (a filled circle), free a
 * faded icon (an outline), so neither relies on colour alone; the resource's name is in the tooltip and
 * the text.
 */
export const resourceNodesLayer: MapLayer<ResourceNode[]> = {
  id: "resourceNodes",
  label: "Resource nodes",
  defaultVisible: true,

  draw({ L, map, project, renderer, color, token }, nodes) {
    const group = L.layerGroup();
    const stroke = color(NODE_TOKEN);
    for (const node of nodes) {
      const url = resourceIconUrl(node.type, node.nodeType);
      if (url !== undefined) {
        L.marker(project(node.x, node.y), { icon: iconMarker(L, url, node), keyboard: false })
          .bindTooltip(() => tooltip(node), { direction: "top", offset: [0, -iconSizePx(token, node.purity) / 2] })
          .addTo(group);
        continue;
      }
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
        {/* gap-2, not gap-1: the ring is drawn outside the sample and would touch its label. */}
        <li className="flex items-center gap-2">
          <Sample used />
          In use (ringed)
        </li>
        <li className="flex items-center gap-2">
          <Sample used={false} />
          Free (faded)
        </li>
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.normal} filled />
          Unknown resource, in use
        </li>
        <li className="flex items-center gap-1">
          <Dot r={PURITY_RADIUS_PX.normal} filled={false} />
          Unknown resource, free
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
      <p>Each resource has its own game icon; the type is also in the tooltip and the table below.</p>
    </div>
  ),

  describe(nodes, options) {
    const of = options?.filteredOf;
    if (nodes.length === 0) {
      return of ? `0 of ${of} resource nodes shown (the rest are hidden by the filters).` : "No resource nodes reported by the server.";
    }
    const used = nodes.filter((n) => n.exploited).length;
    const byType = countByType(nodes)
      .map(([type, n]) => `${n} ${type}`)
      .join(", ");
    if (of) return `${nodes.length} of ${of} resource nodes shown (${used} in use): ${byType}; the rest are hidden by the filters.`;
    return `${countOf(nodes.length, "resource node", "resource nodes")} on the map (${used} in use): ${byType}.`;
  },
};

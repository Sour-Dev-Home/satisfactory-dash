import type { ReactNode } from "react";
import type { RailSegment, ResourceNode } from "@satisfactory-dash/shared";
import type { ViewM } from "./MapCanvas";
import {
  formatMetres,
  formatPoint,
  nodeInView,
  nodeKindLabel,
  polylineLengthM,
  purityLabel,
  railInView,
} from "./worldGeometry";

/**
 * Every world layer's data as text (ADR-0023 decision 7), the way the buildings table does it: the
 * rows in the current view, following pan and zoom. A focusable region, so keyboard users can scroll
 * it (axe scrollable-region-focusable).
 */
/** Nothing in the layer at all, and nothing in the current view. */
export const EMPTY_LAYER = "None on the map.";
export const EMPTY_VIEW = "None in view. Zoom out or pan to see more.";

function ViewTable({ id, title, count, empty, children }: { id: string; title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h4 id={id}>
        {title} ({count})
      </h4>
      {count === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div tabIndex={0} role="region" aria-labelledby={id} className="max-h-80 overflow-auto">
          {children}
        </div>
      )}
    </div>
  );
}

export function ResourceNodesTable({ nodes, view }: { nodes: readonly ResourceNode[]; view: ViewM | null }) {
  const listed = nodes.filter((n) => nodeInView(view, n));
  return (
    <ViewTable id="map-nodes-heading" title="Resource nodes in view" count={listed.length} empty={nodes.length === 0 ? EMPTY_LAYER : EMPTY_VIEW}>
      <table aria-labelledby="map-nodes-heading" className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">Purity</th>
            <th scope="col">Kind</th>
            <th scope="col">State</th>
            <th scope="col">Position (m)</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((n, i) => (
            // Nodes have no id of their own; position and type are unique in the game, the index covers a repeat.
            <tr key={`${n.type}:${n.x}:${n.y}:${i}`}>
              <td data-label="Resource">{n.type}</td>
              <td data-label="Purity">{purityLabel(n.purity)}</td>
              <td data-label="Kind">{nodeKindLabel(n.nodeType)}</td>
              <td data-label="State">{n.exploited ? "In use" : "Free"}</td>
              <td data-label="Position (m)">{formatPoint([n.x, n.y])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ViewTable>
  );
}

export function RailsTable({ segments, view }: { segments: readonly RailSegment[]; view: ViewM | null }) {
  const listed = segments.filter((s) => railInView(view, s));
  return (
    <ViewTable id="map-rails-heading" title="Rail segments in view" count={listed.length} empty={segments.length === 0 ? EMPTY_LAYER : EMPTY_VIEW}>
      <table aria-labelledby="map-rails-heading" className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Length</th>
            <th scope="col">From (m)</th>
            <th scope="col">To (m)</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((s, i) => (
            <tr key={`${s.id}:${i}`}>
              <td data-label="Segment">{s.id}</td>
              <td data-label="Length">{formatMetres(polylineLengthM(s.points))}</td>
              <td data-label="From (m)">{formatPoint(s.points[0])}</td>
              <td data-label="To (m)">{formatPoint(s.points[s.points.length - 1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ViewTable>
  );
}

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
    <ViewTable id="map-nodes-heading" title="Resource nodes in view" count={listed.length} empty="None in view. Zoom out or pan to see more.">
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
              <td>{n.type}</td>
              <td>{purityLabel(n.purity)}</td>
              <td>{nodeKindLabel(n.nodeType)}</td>
              <td>{n.exploited ? "In use" : "Free"}</td>
              <td>{formatPoint([n.x, n.y])}</td>
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
    <ViewTable id="map-rails-heading" title="Rail segments in view" count={listed.length} empty="None in view. Zoom out or pan to see more.">
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
          {listed.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{formatMetres(polylineLengthM(s.points))}</td>
              <td>{formatPoint(s.points[0])}</td>
              <td>{formatPoint(s.points[s.points.length - 1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ViewTable>
  );
}

import type { StatusResponse } from "@satisfactory-dash/shared";
import { formatDuration, formatTime } from "../format";

/**
 * Presentational: renders one status snapshot. Units and labels per ADR-0006. Stale and
 * paused are shown by StatusBanners; this panel keeps showing the snapshot's values. The
 * server tick lives in the Overview's Health card (the owner's call), not here.
 */
export function StatusPanel({ snapshot }: { snapshot: StatusResponse }) {
  const status = snapshot.data;
  return (
    <section aria-labelledby="status-heading" className="panel">
      <h3 id="status-heading">Server status</h3>
      <dl>
        <dt>Save</dt>
        {/* sessionName's value with no save loaded is unverified, so it isn't shown then. */}
        <dd>{status.isGameRunning ? status.sessionName : "No save loaded"}</dd>

        <dt>Players</dt>
        <dd>
          {status.connectedPlayers} / {status.playerLimit} connected
        </dd>

        {status.isGameRunning && (
          <>
            {/* Cumulative play time for the save, not time since the server started. */}
            <dt>Total play time on this save</dt>
            <dd>{formatDuration(status.totalGameDurationSeconds)}</dd>
          </>
        )}

        <dt>As of</dt>
        <dd>
          <time dateTime={snapshot.observedAt}>{formatTime(snapshot.observedAt)}</time>
        </dd>
      </dl>
    </section>
  );
}

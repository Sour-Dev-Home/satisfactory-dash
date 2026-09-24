import type { SettingsResponse } from "@satisfactory-dash/shared";
import { formatTime } from "../format";

interface Props {
  snapshot: SettingsResponse;
  /** Called only on an explicit user action (ADR-0012). */
  onChange: (enabled: boolean) => void;
  saving: boolean;
}

/** Presentational: the server's auto-pause setting (ADR-0012). */
export function AutoPausePanel({ snapshot, onChange, saving }: Props) {
  const { autoPause, pending, editable } = snapshot.data;
  // Stale (ADR-0004) = the backend can't currently read the game server, so a change would
  // fail too; show the last known value, say how old it is, and hold the toggle.
  const stale = snapshot.stale;
  const describedBy = ["auto-pause-help", !editable && "auto-pause-read-only", stale && "auto-pause-stale"]
    .filter(Boolean)
    .join(" ");
  return (
    <section aria-labelledby="settings-heading" className="panel">
      <h3 id="settings-heading">Server settings</h3>
      <label>
        <input
          type="checkbox"
          checked={autoPause}
          disabled={!editable || stale || saving}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
        />{" "}
        Auto-pause when no players are connected
      </label>
      <p id="auto-pause-help">Pausing doesn't lower hosting cost and freezes live values, alerts and history.</p>
      {!editable && <p id="auto-pause-read-only">Read-only: the backend has no verified admin token for this server.</p>}
      {stale && (
        <p id="auto-pause-stale">
          Showing last known settings from {formatTime(snapshot.observedAt)}. Changes are unavailable until the
          server can be reached.
        </p>
      )}
      {pending && <p role="status">Change pending: the server will apply it.</p>}
      {saving && <p role="status">Saving…</p>}
    </section>
  );
}

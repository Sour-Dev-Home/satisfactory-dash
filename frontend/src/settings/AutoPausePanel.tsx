import type { SettingsResponse } from "@satisfactory-dash/shared";

interface Props {
  snapshot: SettingsResponse;
  /** Called only on an explicit user action (ADR-0012). */
  onChange: (enabled: boolean) => void;
  saving: boolean;
}

/** Presentational: the server's auto-pause setting (ADR-0012). */
export function AutoPausePanel({ snapshot, onChange, saving }: Props) {
  const { autoPause, pending, editable } = snapshot.data;
  return (
    <section aria-labelledby="settings-heading" className="panel">
      <h3 id="settings-heading">Server settings</h3>
      <label>
        <input
          type="checkbox"
          checked={autoPause}
          disabled={!editable || saving}
          aria-describedby={editable ? "auto-pause-help" : "auto-pause-help auto-pause-read-only"}
          onChange={(e) => onChange(e.target.checked)}
        />{" "}
        Auto-pause when no players are connected
      </label>
      <p id="auto-pause-help">Pausing doesn't lower hosting cost and freezes live values, alerts and history.</p>
      {!editable && <p id="auto-pause-read-only">Read-only: the backend has no verified admin token for this server.</p>}
      {pending && <p role="status">Change pending: the server will apply it.</p>}
      {saving && <p role="status">Saving…</p>}
    </section>
  );
}

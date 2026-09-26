import { useId, useState, type FormEvent } from "react";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../rules/FormField";
import { fieldAttrs } from "../rules/fieldAttrs";

import { defaultMuteUntil, MAX_MUTE_MS, muteUntilIso, toLocalInput } from "./muteTime";

/**
 * The per-server mute (ADR-0027 decision 4): nothing is sent until the chosen time, at most 7 days
 * ahead. Owners and admins only; the container passes the writes. The time is picked in local time
 * and sent as UTC.
 */
export function MuteControl({
  mutedUntil,
  onMute,
  onUnmute,
  now = Date.now,
}: {
  mutedUntil: string | null;
  onMute: (untilIso: string) => Promise<unknown>;
  onUnmute: () => Promise<unknown>;
  /** The clock, for tests. */
  now?: () => number;
}) {
  const id = useId();
  const [until, setUntil] = useState(() => defaultMuteUntil(now()));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function run(write: () => Promise<unknown>) {
    setFailure(null);
    setBusy(true);
    try {
      await write();
    } catch (e) {
      setFailure(e); // mute_invalid and the rest show the backend's own words
    } finally {
      setBusy(false);
    }
  }

  function mute(e: FormEvent) {
    e.preventDefault();
    const iso = muteUntilIso(until, now());
    if (iso === null) {
      setError("Choose a time in the future, at most 7 days ahead.");
      return;
    }
    setError(undefined);
    void run(() => onMute(iso));
  }

  const hint = "Nothing is sent until then. At most 7 days ahead.";
  return (
    <form onSubmit={mute} noValidate aria-label="Mute alerts" className="grid gap-3">
      <div className="max-w-xs">
        <FormField id={`${id}-until`} label="Mute until" hint={hint} error={error}>
          <input
            {...fieldAttrs(`${id}-until`, hint, error)}
            type="datetime-local"
            value={until}
            min={toLocalInput(now())}
            max={toLocalInput(now() + MAX_MUTE_MS)}
            onChange={(e) => setUntil(e.target.value)}
          />
        </FormField>
      </div>
      {/* The status panel above already says until when it's muted. */}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy}>
          {mutedUntil ? "Change mute" : "Mute"}
        </button>
        {mutedUntil && (
          <button type="button" disabled={busy} onClick={() => void run(onUnmute)}>
            Unmute now
          </button>
        )}
      </div>
      {failure !== null && <ErrorNotice error={failure} />}
    </form>
  );
}

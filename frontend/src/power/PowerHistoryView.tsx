import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PowerResponse } from "@satisfactory-dash/shared";
import { POLL_MS, queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { appendReading } from "./history";
import { PowerHistoryPanel } from "./PowerHistoryPanel";

/** Enough polls to cover any window the backend sends (5 min at 10 s = 30), with room. */
const MAX_READINGS = 120;

/**
 * Container (ADR-0022). The history is keyed by the loaded save: a game reload clears the
 * backend's history, and a new key refetches it, so a series never spans a reload here
 * either. So it waits for status (almost always cached already: the shell's banners poll
 * it), rather than loading once without a session and again with one. A status error
 * doesn't block the chart; it just loads unkeyed.
 */
export function PowerHistoryView() {
  const server = useSelectedServer();
  const status = useQuery(queries.status(server.id));
  if (!status.data && !status.isError) return <p role="status">Loading power history…</p>;
  return <PowerHistoryLoaded serverId={server.id} session={status.data?.data.sessionName} />;
}

/**
 * Loads the history once per mount (and on refocus, the query default), then appends each
 * regular power poll to it. The cache keeps exactly what the server sent; the polls are
 * folded on top here, so a refetch simply replaces the base and polls it already covers are
 * skipped (appendReading only adds newer points).
 */
function PowerHistoryLoaded({ serverId, session }: { serverId: string; session: string | undefined }) {
  const history = useQuery(queries.powerHistory(serverId, session));
  const power = useQuery(queries.power(serverId));

  // Every power snapshot seen while mounted. Updated during render (React's pattern for
  // state derived from a changing value), not in an effect, so no extra render pass.
  const [readings, setReadings] = useState<PowerResponse[]>([]);
  if (power.data && readings.at(-1) !== power.data) {
    setReadings([...readings.slice(-(MAX_READINGS - 1)), power.data]);
  }

  const merged = useMemo(() => {
    if (!history.data) return undefined;
    const base = history.data.data;
    const serverNewest = Math.max(-Infinity, ...base.series.map((s) => s.points.at(-1)?.t ?? -Infinity));
    // Only this server's polls, and none older than the history itself: after a reset
    // (backend restart, new save) the history comes back empty, and polls from before it
    // must not be re-appended.
    const since = Date.parse(history.data.observedAt);
    const fresh = readings.filter((r) => r.serverId === serverId && Date.parse(r.observedAt) >= since);
    return {
      history: fresh.reduce(appendReading, base),
      live: { afterT: serverNewest, intervalSeconds: POLL_MS.power / 1000 },
    };
  }, [history.data, readings, serverId]);

  if (history.isPending) return <p role="status">Loading power history…</p>;
  return (
    <>
      {history.isError && <ErrorNotice error={history.error} />}
      {history.data?.stale && <p>Power history is behind: showing the last readings the server kept.</p>}
      {merged && <PowerHistoryPanel history={merged.history} live={merged.live} />}
    </>
  );
}

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
 * Container (ADR-0022): loads the history once per mount (and on refocus, the query
 * default), then appends each regular power poll to it. The cache keeps exactly what the
 * server sent; the polls are folded on top here, so a refetch simply replaces the base and
 * polls it already covers are skipped (appendReading only adds newer points).
 */
export function PowerHistoryView() {
  const server = useSelectedServer();
  const history = useQuery(queries.powerHistory(server.id));
  const power = useQuery(queries.power(server.id));

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
    return {
      history: readings.reduce(appendReading, base),
      live: { afterT: serverNewest, intervalSeconds: POLL_MS.power / 1000 },
    };
  }, [history.data, readings]);

  if (history.isPending) return <p role="status">Loading power history…</p>;
  return (
    <>
      {history.isError && <ErrorNotice error={history.error} />}
      {history.data?.stale && <p>Power history is behind: showing the last readings the server kept.</p>}
      {merged && <PowerHistoryPanel history={merged.history} live={merged.live} />}
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { formatTime } from "../format";
import { useSelectedServer } from "../servers/ServerContext";
import { ErrorNotice } from "./ErrorNotice";

/**
 * Server-wide states from the polled status snapshot. Stale (ADR-0004: the backend is
 * serving last known data) and paused (ADR-0012: the game itself is frozen) are separate
 * banners because they mean different things and can both be true.
 */
export function StatusBanners() {
  const server = useSelectedServer();
  const status = useQuery(queries.status(server.id));

  if (status.isPending) return <p role="status">Loading server status…</p>;

  const snapshot = status.data;
  return (
    <>
      {status.isError && <ErrorNotice error={status.error} />}
      {snapshot?.stale && (
        <p role="status" className="banner banner-stale">
          Showing last known data from {formatTime(snapshot.observedAt)}.
        </p>
      )}
      {snapshot?.data.gamePaused && (
        <p role="status" className="banner banner-paused">
          Paused: no players connected, values are frozen.
        </p>
      )}
    </>
  );
}

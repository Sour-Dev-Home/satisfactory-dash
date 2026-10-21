import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { formatTime } from "../format";
import { useSelectedServer } from "../servers/ServerContext";
import { ErrorNotice } from "./ErrorNotice";

/**
 * Server-wide states from the polled status snapshot. Stale (ADR-0004: the backend is
 * serving last known data) and paused (ADR-0012: the game itself is frozen) are separate
 * banners because they mean different things and can both be true.
 *
 * This is also the one place "Game server unreachable" is said (panels show a quiet empty
 * state instead: PanelError). Its notice stays up through the polls of a status read that
 * has never answered, so the banner row neither collapses nor re-mounts every interval.
 *
 * `showPaused={false}` leaves the paused banner out where the page already says so (the
 * Overview's Server row), so the Overview's own banner stays the one verdict at the top.
 */
export function StatusBanners({ showPaused = true }: { showPaused?: boolean }) {
  const server = useSelectedServer();
  const { query: status, firstLoad, error } = useSettledQuery(queries.status(server.id));

  // Nothing while it first loads: the page reveals once, and a line here would add a row above it and push it down (#494).
  if (firstLoad) return null;

  const snapshot = status.data;
  return (
    <>
      {error != null && <ErrorNotice error={error} />}
      {snapshot?.stale && (
        <p role="status" className="banner banner-stale">
          Showing last known data from {formatTime(snapshot.observedAt)}.
        </p>
      )}
      {showPaused && snapshot?.data.gamePaused && (
        <p role="status" className="banner banner-paused">
          Paused: no players connected, values are frozen.
        </p>
      )}
    </>
  );
}

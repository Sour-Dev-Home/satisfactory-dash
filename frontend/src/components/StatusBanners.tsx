import { useDeployGapPhase } from "../api/deployGap";
import { classifyError, isDeployGapError } from "../api/errors";
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
 * state instead: PanelError), from the status read's 503 or, with the last reading kept, from
 * its `unreachableSince` (ADR-0052). Its notice stays up through the polls of a status read that
 * has never answered, so the banner row neither collapses nor re-mounts every interval.
 *
 * `showPaused={false}` leaves the paused banner out where the page already says so (the
 * Overview's Server row), so the Overview's own banner stays the one verdict at the top.
 */
export function StatusBanners({ showPaused = true }: { showPaused?: boolean }) {
  const server = useSelectedServer();
  const { query: status, firstLoad, error } = useSettledQuery(queries.status(server.id));
  const deployGap = useDeployGapPhase();

  // Nothing while it first loads: the page reveals once, and a line here would add a row above it and push it down (#494).
  if (firstLoad) return null;

  const snapshot = status.data;
  // ADR-0052: a 200 with unreachableSince is the same news as a 503 upstream_unreachable ("nothing to show"), with the
  // last reading kept. The error path stays for the 503s; when a refresh failed that way too, its notice says it once.
  const unreachableSince = snapshot?.unreachableSince;
  const unreachableSaid = error != null && classifyError(error) === "upstream_unreachable";
  // ADR-0054 D4: while the backend is being replaced the notice below says it once, and the failed status read's own
  // "couldn't reach the backend" stays quiet. Past DEPLOY_GAP_GIVE_UP_MS the phase is "down" and that wording returns.
  const updating = deployGap === "updating";
  const errorSaid = updating && isDeployGapError(error);
  return (
    <>
      {updating && (
        <p role="status" className="banner banner-updating">
          The dashboard is updating, back in a moment.
        </p>
      )}
      {error != null && !errorSaid && <ErrorNotice error={error} />}
      {unreachableSince !== undefined && !unreachableSaid && (
        <p role="status" className="banner banner-stale">
          Game server unreachable since {formatTime(unreachableSince)}.
        </p>
      )}
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

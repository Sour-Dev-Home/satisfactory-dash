import { isUpdatingGap, type DeployGapPhase } from "../api/deployGap";
import { classifyError } from "../api/errors";

/** What a panel with a failed read shows: its own notice, a quiet empty panel, or the calm "updating" state. */
export type PanelErrorKind = "notice" | "unreachable" | "updating";

const isUnreachable = (error: unknown) => error != null && classifyError(error) === "upstream_unreachable";

/**
 * The panel's state for a failed read. A panel with no data during a recent deploy gap (ADR-0054 D4) is "updating",
 * not an error (the banner says the rest); past the give-up, or for any other error, nothing changes. A panel that
 * still has its last data is never "updating": it keeps the data. "unreachable" is the game server being down,
 * said once by StatusBanners, when the status read says so too.
 */
export function panelErrorKind(error: unknown, statusError: unknown, phase: DeployGapPhase, hasData: boolean): PanelErrorKind {
  if (!hasData && isUpdatingGap(error, phase)) return "updating";
  if (isUnreachable(error) && isUnreachable(statusError)) return "unreachable";
  return "notice";
}

import type { Settings } from "@satisfactory-dash/shared";
import type { ServerOptionsPort } from "../../gameserver/index.js";
import { NotEditableError } from "../../../platform/errorResponse.js";
import { UpstreamError } from "../../../platform/errors.js";

/** ADR-0012: the auto-pause setting, as `{ autoPause, pending, editable }`. */
export class SettingsService {
  constructor(private readonly options: ServerOptionsPort) {}

  async getSettings(): Promise<Settings> {
    // A failed token check degrades to read-only instead of failing the whole read: the
    // value itself was readable. (If the server is really down, the read fails anyway.)
    const [state, editable] = await Promise.all([
      this.options.readAutoPause(),
      this.options.canEditOptions().catch(() => false),
    ]);
    return { ...state, editable };
  }

  /**
   * Applies the change, re-reads it from the server and returns the new settings. A server
   * the dashboard can't edit gets NotEditableError (409 not_editable) before anything is
   * written. `onApplied` runs right after the write succeeds, before the re-read, so the
   * audit line exists even if the re-read then fails (ADR-0012: one line per change).
   *
   * A write can time out or drop after the game server already applied it (the request
   * deadline is overall now, so a slow-but-steady response can be cut). Setting the option is
   * idempotent, so on such a transport failure the service reads it back once: if the server
   * now holds the requested value the write landed and it answers as a success (the audit
   * line says the outcome was confirmed by that re-read); otherwise the original failure
   * (503) stands.
   */
  async setAutoPause(
    enabled: boolean,
    onApplied: (change: { from: boolean; to: boolean; confirmedByReread?: boolean }) => void,
  ): Promise<Settings> {
    if (!(await this.options.canEditOptions())) {
      throw new NotEditableError();
    }
    const from = (await this.options.readAutoPause()).autoPause;
    try {
      await this.options.applyAutoPause(enabled);
    } catch (err) {
      // The server refused the write for lack of privilege: not editable, not a fault.
      if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
        throw new NotEditableError();
      }
      if (err instanceof UpstreamError && err.failureKind === "unreachable") {
        const confirmed = await this.readBackIfApplied(enabled);
        if (confirmed) {
          onApplied({ from, to: enabled, confirmedByReread: true });
          return { ...confirmed, editable: true };
        }
      }
      throw err;
    }
    onApplied({ from, to: enabled });
    const state = await this.options.readAutoPause();
    return { ...state, editable: true };
  }

  /** One read-back after a failed write: the state if the server now holds `enabled`, else
   *  undefined (including when the read itself fails: the caller then rethrows the write's error). */
  private async readBackIfApplied(enabled: boolean): Promise<{ autoPause: boolean; pending: boolean } | undefined> {
    try {
      const state = await this.options.readAutoPause();
      return state.autoPause === enabled ? state : undefined;
    } catch {
      return undefined;
    }
  }
}

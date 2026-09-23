import type { Settings } from "@satisfactory-dash/shared";
import type { ServerOptionsPort } from "../../gameserver/index.js";
import { NotEditableError } from "../../../platform/errorResponse.js";

/** ADR-0012: the auto-pause setting, as `{ autoPause, pending, editable }`. */
export class SettingsService {
  constructor(private readonly options: ServerOptionsPort) {}

  async getSettings(): Promise<Settings> {
    const [state, editable] = await Promise.all([this.options.readAutoPause(), this.options.canEditOptions()]);
    return { ...state, editable };
  }

  /**
   * Applies the change, re-reads it from the server and returns the new settings with the
   * previous value (for the audit log). A server the dashboard can't edit gets
   * NotEditableError (409 not_editable) before anything is written.
   */
  async setAutoPause(enabled: boolean): Promise<{ before: boolean; settings: Settings }> {
    if (!(await this.options.canEditOptions())) {
      throw new NotEditableError();
    }
    const before = (await this.options.readAutoPause()).autoPause;
    await this.options.applyAutoPause(enabled);
    const state = await this.options.readAutoPause();
    return { before, settings: { ...state, editable: true } };
  }
}

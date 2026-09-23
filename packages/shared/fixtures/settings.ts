import type { SetAutoPauseRequest, SettingsResponse } from "../src/index";

const meta = { serverId: "default", observedAt: "2026-09-22T22:25:04.000Z", stale: false };

/** Admin token verified: the toggle is live. Auto-pause off, as recommended (ADR-0012). */
export const settingsEditable = {
  ...meta,
  data: { autoPause: false, pending: false, editable: true },
} satisfies SettingsResponse;

/** No verified Administrator token: show the setting read-only. */
export const settingsReadOnly = {
  ...meta,
  data: { autoPause: true, pending: false, editable: false },
} satisfies SettingsResponse;

/** A change that the server hasn't applied yet. Whether this state occurs for
 *  FG.DSAutoPause at all is [NEEDS VERIFICATION]; it looked immediate on 2026-09-22. */
export const settingsPending = {
  ...meta,
  data: { autoPause: true, pending: true, editable: true },
} satisfies SettingsResponse;

export const setAutoPauseRequestOn = { enabled: true } satisfies SetAutoPauseRequest;
export const setAutoPauseRequestOff = { enabled: false } satisfies SetAutoPauseRequest;

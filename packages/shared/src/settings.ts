import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/**
 * ADR-0012: the server's auto-pause setting. The dashboard changes it only on an
 * explicit user action. Read from an allowlist of GetServerOptions keys; nothing else
 * from that response is ever returned (it contains FRM's auth token).
 */
export const SettingsSchema = z.object({
  autoPause: z
    .boolean()
    .describe(
      "The server's FG.DSAutoPause: pause the simulation when no players are connected. " +
        "Pausing doesn't lower hosting cost and freezes live values, alerts and history.",
    ),
  pending: z
    .boolean()
    .describe("true = a change is waiting to be applied by the server (it appears in PendingServerOptions)"),
  editable: z
    .boolean()
    .describe(
      "true = the backend holds a verified Administrator token for this server, so the setting " +
        "can be changed. false = show it read-only; a change attempt gets 409 not_editable.",
    ),
});
export const SettingsResponseSchema = snapshotEnvelope(SettingsSchema);

export const SetAutoPauseRequestSchema = z.object({
  enabled: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type SetAutoPauseRequest = z.infer<typeof SetAutoPauseRequestSchema>;

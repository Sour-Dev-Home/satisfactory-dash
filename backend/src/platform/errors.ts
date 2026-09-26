/**
 * `UpstreamError` (the base class of every "the game server failed" error) and `RequestFailureKind` are defined in
 * the game-adapter package, because the adapter throws them (ADR-0031 PR 2). They are re-exported here, the same
 * class, so `instanceof UpstreamError` in platform/errorResponse.ts still recognises what the adapter throws.
 * platform/errorResponse.ts maps ONLY these to upstream_* codes (502/503).
 */
export { UpstreamError } from "@satisfactory-dash/game-adapter";
export type { RequestFailureKind } from "@satisfactory-dash/game-adapter";

/** A configuration the backend refuses to start with. server.ts reports it and exits.
 *  Shared by every module's config loader (gameserver, servers, identity). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

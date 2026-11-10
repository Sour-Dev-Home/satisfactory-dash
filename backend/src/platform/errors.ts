/* ADR-0066 build PR 6: the `UpstreamError` re-export from the game-adapter package is gone; nothing in the backend throws
 * one since direct polling was retired. */

/** A configuration the backend refuses to start with. server.ts reports it and exits.
 *  Shared by every module's config loader (servers, identity). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

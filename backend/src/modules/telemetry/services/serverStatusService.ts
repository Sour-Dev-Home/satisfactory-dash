import type { Status } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../../gameserver/index.js";
import { mapStatus } from "../../gameserver/index.js";

export interface ServerStatusAdapterLike {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
}

/**
 * Merges the vanilla API's HealthCheck and QueryServerState into the contract's Status (packages/shared/src/status.ts).
 * The adapter validates both responses (the game-adapter package's rawSchemas.ts), so the values are already well-formed;
 * the response is validated once more against the contract on the way out (ADR-0002). The merge itself is the shared
 * shape mapping (`mapStatus`), the same one the edge agent uses (ADR-0031).
 */
export class ServerStatusService {
  constructor(private readonly adapter: ServerStatusAdapterLike) {}

  async getStatus(): Promise<Status> {
    const [health, status] = await Promise.all([this.adapter.getServerHealth(), this.adapter.getServerStatus()]);
    return mapStatus(health, status);
  }
}

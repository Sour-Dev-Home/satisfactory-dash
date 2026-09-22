import type { ServerStatusResponse } from "@satisfactory-dash/shared";
import type { ServerHealth, ServerStatus } from "../adapters/domain.js";

export interface ServerStatusAdapterLike {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
}

export class ServerStatusService {
  constructor(private readonly adapter: ServerStatusAdapterLike) {}

  async getStatus(): Promise<ServerStatusResponse> {
    const [health, status] = await Promise.all([
      this.adapter.getServerHealth(),
      this.adapter.getServerStatus(),
    ]);
    return { healthy: health.healthy, ...status };
  }
}

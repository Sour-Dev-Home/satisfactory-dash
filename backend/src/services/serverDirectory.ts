import type { ServerSummary } from "@satisfactory-dash/shared";
import type { ServerStatusService } from "./serverStatusService.js";
import type { ProductionService } from "./productionService.js";
import type { PowerService } from "./powerService.js";

/** The services the data routes need for one game server. Narrowed with Pick so route
 *  tests can supply stubs. */
export interface ServerServices {
  status: Pick<ServerStatusService, "getStatus">;
  production: Pick<ProductionService, "getFactoryOverview">;
  power: Pick<PowerService, "getPowerOverview">;
}

export interface ServerDirectoryEntry extends ServerSummary {
  services: ServerServices;
}

/**
 * ADR-0001: every data route is scoped to a server id, resolved here. Today it holds
 * one entry (the registry of one built in server.ts); when a second server exists,
 * where the registry lives is decided then (ADR-0001's revisit trigger), and only
 * this interface's implementation changes.
 */
export interface ServerDirectory {
  list(): ServerSummary[];
  get(id: string): ServerServices | undefined;
}

export class InMemoryServerDirectory implements ServerDirectory {
  private readonly byId = new Map<string, ServerDirectoryEntry>();

  constructor(entries: ServerDirectoryEntry[]) {
    for (const entry of entries) {
      if (this.byId.has(entry.id)) {
        throw new Error(`Duplicate server id "${entry.id}"`);
      }
      this.byId.set(entry.id, entry);
    }
  }

  list(): ServerSummary[] {
    // Only id and displayName: GET /api/servers never exposes a host or port.
    return [...this.byId.values()].map(({ id, displayName }) => ({ id, displayName }));
  }

  get(id: string): ServerServices | undefined {
    return this.byId.get(id)?.services;
  }
}

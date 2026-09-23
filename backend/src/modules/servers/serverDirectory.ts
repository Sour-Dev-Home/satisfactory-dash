import type { ServerSummary } from "@satisfactory-dash/shared";

export interface ServerDirectoryEntry<TServices> extends ServerSummary {
  /** Opaque to this module: whatever the composition root bundles for one server (the
   *  telemetry services today, plus settings later). Servers only stores and returns it. */
  services: TServices;
}

/**
 * ADR-0001: every data route is scoped to a server id, resolved here. Today it holds
 * one entry (the registry of one built in server.ts); when a second server exists,
 * where the registry lives is decided then (ADR-0001's revisit trigger), and only
 * this interface's implementation changes.
 */
export interface ServerDirectory<TServices> {
  list(): ServerSummary[];
  get(id: string): TServices | undefined;
}

export class InMemoryServerDirectory<TServices> implements ServerDirectory<TServices> {
  private readonly byId = new Map<string, ServerDirectoryEntry<TServices>>();

  constructor(entries: ServerDirectoryEntry<TServices>[]) {
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

  get(id: string): TServices | undefined {
    return this.byId.get(id)?.services;
  }
}

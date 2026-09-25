import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { ImportError, MAX_LOCAL_SERVERS, importServers } from "./importServers.js";
import type { ImportableServer } from "./importServers.js";

const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

/** An in-memory stand-in for the three statements the import runs, with transaction bookkeeping. */
function fakePool(existingConnections: string[] = []) {
  const connections = new Map<string, unknown[]>(existingConnections.map((id) => [id, []]));
  const serverIds = new Map<string, string>();
  const state = { began: 0, committed: 0, rolledBack: 0 };
  const client = {
    on: () => client,
    removeListener: () => client,
    release: () => undefined,
    async query(text: string, values: unknown[] = []) {
      if (text.startsWith("BEGIN")) state.began++;
      if (text.startsWith("COMMIT")) state.committed++;
      if (text.startsWith("ROLLBACK")) state.rolledBack++;
      if (text.includes("INSERT INTO servers.servers ")) {
        const publicId = String(values[0]);
        if (!serverIds.has(publicId)) serverIds.set(publicId, `uuid-${publicId}`);
        return {
          rows: [{ id: serverIds.get(publicId), public_id: publicId, display_name: values[1], hosting_mode: "self", connection_kind: "local" }],
        };
      }
      if (text.includes("INSERT INTO servers.server_connections")) {
        const serverId = String(values[0]);
        if (connections.has(serverId)) return { rows: [] };
        connections.set(serverId, values);
        return { rows: [{ server_id: serverId }] };
      }
      if (text.includes("SELECT 1 FROM servers.server_connections")) {
        return { rows: connections.has(String(values[0])) ? [{ "?column?": 1 }] : [] };
      }
      if (text.includes("count(*)")) return { rows: [{ count: connections.size }] };
      return { rows: [] };
    },
  };
  const pool = { connect: async () => client } as unknown as Parameters<typeof importServers>[0];
  return { pool, connections, state };
}

const configured = (id: string, over: Partial<ImportableServer["config"]> = {}): ImportableServer => ({
  id,
  displayName: `Name ${id}`,
  config: {
    host: "192.168.1.20",
    apiPort: 7777,
    apiToken: `api-token-for-${id}-12345`,
    apiAllowSelfSignedCert: true,
    frmPort: 8080,
    frmToken: "frm-token-12345678",
    requestTimeoutMs: 5000,
    ...over,
  },
});

const resolve = async (host: string) => (host === "localhost" ? "127.0.0.1" : host);

describe("importServers", () => {
  it("imports servers, encrypted, in one committed transaction", async () => {
    const { pool, connections, state } = fakePool();
    const result = await importServers(pool, ring, [configured("a"), configured("b", { host: "localhost", frmToken: undefined })], resolve);
    expect(result).toEqual({ imported: ["a", "b"], skipped: [], warnings: [] });
    expect(state).toMatchObject({ began: 1, committed: 1, rolledBack: 0 });
    const [, host, pinnedIp, apiPort, frmPort, apiEnc, frmEnc, keyId] = connections.get("uuid-b")!;
    expect([host, pinnedIp, apiPort, frmPort, keyId]).toEqual(["localhost", "127.0.0.1", 7777, 8080, "k1"]);
    expect(frmEnc).toBeNull();
    expect((apiEnc as Buffer).includes(Buffer.from("api-token-for-b"))).toBe(false);
  });

  it("is idempotent: a server that already has a connection is skipped, not overwritten", async () => {
    const { pool, connections } = fakePool();
    await importServers(pool, ring, [configured("a")], resolve);
    const before = connections.get("uuid-a");
    const again = await importServers(pool, ring, [configured("a", { apiPort: 9999 })], resolve);
    expect(again).toEqual({ imported: [], skipped: ["a"], warnings: [] });
    expect(connections.get("uuid-a")).toBe(before);
  });

  it("treats a blank FRM token as no token", async () => {
    const { pool, connections } = fakePool();
    await importServers(pool, ring, [configured("a", { frmToken: "" })], resolve);
    expect(connections.get("uuid-a")![6]).toBeNull();
  });

  it("refuses a server with no API token, and rolls back what it had done", async () => {
    const { pool, connections, state } = fakePool();
    await expect(importServers(pool, ring, [configured("a"), configured("b", { apiToken: " " })], resolve)).rejects.toThrow(ImportError);
    expect(state.rolledBack).toBe(1);
    expect(state.committed).toBe(0);
    expect(connections.size).toBe(1); // the fake keeps a's row: the real rollback removes it (see the DB test)
  });

  it("refuses a server that verifies its TLS certificate, because that setting is not stored", async () => {
    const { pool } = fakePool();
    await expect(importServers(pool, ring, [configured("a", { apiAllowSelfSignedCert: false })], resolve)).rejects.toThrow(/TLS certificate/);
  });

  it("warns (by id only) about a custom request timeout, which is not stored", async () => {
    const { pool } = fakePool();
    const result = await importServers(pool, ring, [configured("a", { requestTimeoutMs: 9000 })], resolve);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"a"');
    expect(result.warnings[0]).not.toContain("9000");
  });

  it("refuses a host that cannot be resolved to a pinned address", async () => {
    const { pool } = fakePool();
    await expect(importServers(pool, ring, [configured("a")], async () => Promise.reject(new Error("ENOTFOUND")))).rejects.toThrow(/could not be resolved/);
  });

  it("refuses more than the cap of local servers, rolling back", async () => {
    const { pool, state } = fakePool();
    const many = Array.from({ length: MAX_LOCAL_SERVERS + 1 }, (_, i) => configured(`s${i}`));
    await expect(importServers(pool, ring, many, resolve)).rejects.toThrow(/limit of 8/);
    expect(state.committed).toBe(0);
  });

  it("no error or result ever carries a token", async () => {
    const { pool } = fakePool();
    const bad = configured("a", { apiAllowSelfSignedCert: false });
    let message = "";
    try {
      await importServers(pool, ring, [bad], resolve);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain(bad.config.apiToken!);
    expect(message).not.toContain(bad.config.frmToken!);
  });
});

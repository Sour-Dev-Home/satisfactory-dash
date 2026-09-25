import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { getConnection, getConnectionSummary, listConnections, saveConnection } from "./connectionRepository.js";

// No SQL runs here (the real statements are covered by connectionRepository.db.test.ts in CI): a fake
// Queryable records what would be written, and serves it back as a row, to test the sealing itself.

const SERVER_A = "11111111-1111-4111-8111-111111111111";
const SERVER_B = "22222222-2222-4222-8222-222222222222";
const API_TOKEN = "api-token-abcdefghij1234";
const FRM_TOKEN = "frm-token-klmnopqrst5678";

const newRing = (id = "k1", key = randomBytes(32)) => createSecretsKeyring(id, new Map([[id, key]]));

interface Written {
  params: unknown[];
}

function recordingDb(): Queryable & { written: Written[] } {
  const written: Written[] = [];
  return {
    written,
    async query(_text, values = []) {
      written.push({ params: values });
      return { rows: [{ server_id: values[0] }] };
    },
  };
}

/** A row as Postgres would return it for what `saveConnection` wrote for `serverId`. */
function rowFrom(written: Written, serverId: string, overrides: Record<string, unknown> = {}) {
  const [, host, pinnedIp, apiPort, frmPort, apiEnc, frmEnc, keyId] = written.params;
  return {
    server_id: serverId,
    public_id: "srv",
    connection_kind: "local",
    host,
    pinned_ip: pinnedIp,
    api_port: apiPort,
    frm_port: frmPort,
    api_token_enc: apiEnc,
    frm_token_enc: frmEnc,
    key_id: keyId,
    ...overrides,
  };
}

const servingDb = (rows: unknown[]): Queryable => ({ query: async () => ({ rows }) });

const input = { host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API_TOKEN, frmToken: FRM_TOKEN };

async function saved(ring = newRing()) {
  const db = recordingDb();
  expect(await saveConnection(db, ring, SERVER_A, input)).toBe(true);
  return { ring, written: db.written[0]! };
}

describe("saveConnection", () => {
  it("writes only ciphertext: no token appears in any SQL parameter", async () => {
    const { written } = await saved();
    for (const param of written.params) {
      const text = Buffer.isBuffer(param) ? param.toString("latin1") : String(param);
      expect(text).not.toContain(API_TOKEN);
      expect(text).not.toContain(FRM_TOKEN);
    }
    expect(Buffer.isBuffer(written.params[5])).toBe(true);
    expect(written.params[7]).toBe("k1");
  });

  it("stores no FRM ciphertext when there is no FRM token", async () => {
    const db = recordingDb();
    await saveConnection(db, newRing(), SERVER_A, { ...input, frmToken: undefined });
    expect(db.written[0]!.params[6]).toBeNull();
  });

  it("reports false when the database wrote nothing (unknown, deleted or non-local server)", async () => {
    const db: Queryable = { query: async () => ({ rows: [] }) };
    expect(await saveConnection(db, newRing(), SERVER_A, input)).toBe(false);
  });
});

describe("reading back", () => {
  it("opens both tokens", async () => {
    const { ring, written } = await saved();
    const connection = await getConnection(servingDb([rowFrom(written, SERVER_A)]), ring, SERVER_A);
    expect(connection).toMatchObject({ host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API_TOKEN, frmToken: FRM_TOKEN });
  });

  it("returns undefined when there is no row", async () => {
    expect(await getConnection(servingDb([]), newRing(), SERVER_A)).toBeUndefined();
  });

  it("the summary carries set flags and the last 4 characters, never a token", async () => {
    const { ring, written } = await saved();
    const summary = await getConnectionSummary(servingDb([rowFrom(written, SERVER_A)]), ring, SERVER_A);
    expect(summary).toMatchObject({ apiTokenSet: true, apiTokenLast4: "1234", frmTokenSet: true, frmTokenLast4: "5678" });
    const json = JSON.stringify(summary);
    expect(json).not.toContain(API_TOKEN);
    expect(json).not.toContain(FRM_TOKEN);
  });

  it("shows no suffix for a short token (it would reveal most of it)", async () => {
    const ring = newRing();
    const db = recordingDb();
    await saveConnection(db, ring, SERVER_A, { ...input, apiToken: "short-tok", frmToken: undefined });
    const summary = await getConnectionSummary(servingDb([rowFrom(db.written[0]!, SERVER_A)]), ring, SERVER_A);
    expect(summary).toMatchObject({ apiTokenLast4: null, frmTokenSet: false, frmTokenLast4: null });
  });
});

describe("the sealing context binds a value to its row and field", () => {
  it("a row copied to another server does not open", async () => {
    const { ring, written } = await saved();
    await expect(getConnection(servingDb([rowFrom(written, SERVER_B)]), ring, SERVER_B)).rejects.toThrow("Could not decrypt");
  });

  it("the API and FRM ciphertexts cannot be swapped", async () => {
    const { ring, written } = await saved();
    const swapped = rowFrom(written, SERVER_A, { api_token_enc: written.params[6], frm_token_enc: written.params[5] });
    await expect(getConnection(servingDb([swapped]), ring, SERVER_A)).rejects.toThrow("Could not decrypt");
  });

  it("uses the kind on the row, so a server flipped to another kind stops opening", async () => {
    const { ring, written } = await saved();
    await expect(getConnection(servingDb([rowFrom(written, SERVER_A, { connection_kind: "agent" })]), ring, SERVER_A)).rejects.toThrow("Could not decrypt");
  });
});

describe("listConnections", () => {
  it("opens readable rows and reports the others by key id, never skipping them", async () => {
    const oldKey = randomBytes(32);
    const oldRing = newRing("k1", oldKey);
    const ring = createSecretsKeyring("k2", new Map([["k2", randomBytes(32)], ["k1", oldKey]]));
    const oldDb = recordingDb();
    await saveConnection(oldDb, oldRing, SERVER_A, input);
    const newDb = recordingDb();
    await saveConnection(newDb, ring, SERVER_B, input);
    const rows = [
      rowFrom(oldDb.written[0]!, SERVER_A, { public_id: "a" }),
      rowFrom(newDb.written[0]!, SERVER_B, { public_id: "b" }),
    ];
    const list = await listConnections(servingDb(rows), ring);
    expect(list.connections.map((c) => c.publicId)).toEqual(["a", "b"]);
    expect(list.unreadable).toEqual([]);

    // A ring that lacks k1 cannot read the old row.
    const noOld = createSecretsKeyring("k2", new Map([["k2", randomBytes(32)]]));
    const partial = await listConnections(servingDb(rows), noOld);
    expect(partial.unreadable.map((u) => u.keyId).sort()).toEqual(["k1", "k2"]);
    expect(partial.connections).toEqual([]);
  });

  it("reports every row as unreadable when there is no keyring", async () => {
    const { written } = await saved();
    const list = await listConnections(servingDb([rowFrom(written, SERVER_A)]), null);
    expect(list.connections).toEqual([]);
    expect(list.unreadable).toEqual([{ serverId: SERVER_A, publicId: "srv", keyId: "k1" }]);
  });

  it("reports a modified value as unreadable, without its content", async () => {
    const { ring, written } = await saved();
    const tampered = Buffer.from(written.params[5] as Buffer);
    tampered[14] = tampered[14]! ^ 0x01;
    const list = await listConnections(servingDb([rowFrom(written, SERVER_A, { api_token_enc: tampered })]), ring);
    expect(list.connections).toEqual([]);
    expect(list.unreadable).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(API_TOKEN);
  });

  it("refuses a row whose shape drifted", async () => {
    const { ring, written } = await saved();
    await expect(listConnections(servingDb([rowFrom(written, SERVER_A, { pinned_ip: "not-an-ip" })]), ring)).rejects.toThrow("Unexpected database row shape");
  });
});

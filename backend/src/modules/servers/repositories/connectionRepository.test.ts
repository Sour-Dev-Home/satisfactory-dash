import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { listConnections } from "./connectionRepository.js";

// No SQL runs here (the real statement is covered by connectionRepository.db.test.ts in CI): a fake Queryable serves
// rows to test the opening itself.
//
// ADR-0066 build PR 6: the write paths are gone, so the rows are sealed here the way the retired `saveConnection` sealed
// them: the context `<server id>:<kind>:<field>`. That is deliberate. The restore drill must open rows written by the old
// code, so a change to the context format the reader uses fails here.

const SERVER_A = "11111111-1111-4111-8111-111111111111";
const SERVER_B = "22222222-2222-4222-8222-222222222222";
const API_TOKEN = "api-token-abcdefghij1234";
const FRM_TOKEN = "frm-token-klmnopqrst5678";

const newRing = (id = "k1", key = randomBytes(32)) => createSecretsKeyring(id, new Map([[id, key]]));

/** A row as Postgres returns it for a connection the old code stored for `serverId` (a 'local' server). */
function sealedRow(ring: SecretsKeyring, serverId: string, overrides: Record<string, unknown> = {}, frmToken: string | null = FRM_TOKEN) {
  const api = ring.seal(API_TOKEN, `${serverId}:local:api`);
  const frm = frmToken === null ? undefined : ring.seal(frmToken, `${serverId}:local:frm`);
  return {
    server_id: serverId,
    public_id: "srv",
    display_name: "Srv",
    connection_kind: "local",
    host: "192.168.1.20",
    pinned_ip: "192.168.1.20",
    api_port: 7777,
    frm_port: 8080,
    api_token_enc: api.data,
    frm_token_enc: frm?.data ?? null,
    key_id: api.keyId,
    ...overrides,
  };
}

const servingDb = (rows: unknown[]): Queryable => ({ query: async () => ({ rows }) });

describe("listConnections", () => {
  it("opens both tokens of a stored row", async () => {
    const ring = newRing();
    const list = await listConnections(servingDb([sealedRow(ring, SERVER_A)]), ring);
    expect(list.unreadable).toEqual([]);
    expect(list.connections).toEqual([
      { serverId: SERVER_A, publicId: "srv", displayName: "Srv", host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API_TOKEN, frmToken: FRM_TOKEN },
    ]);
  });

  it("a row with no FRM token opens without one", async () => {
    const ring = newRing();
    const list = await listConnections(servingDb([sealedRow(ring, SERVER_A, {}, null)]), ring);
    expect(list.connections[0]).not.toHaveProperty("frmToken");
  });

  it("opens readable rows and reports the others by key id, never skipping them", async () => {
    const oldKey = randomBytes(32);
    const oldRing = newRing("k1", oldKey);
    const ring = createSecretsKeyring("k2", new Map([["k2", randomBytes(32)], ["k1", oldKey]]));
    const rows = [sealedRow(oldRing, SERVER_A, { public_id: "a" }), sealedRow(ring, SERVER_B, { public_id: "b" })];
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
    const list = await listConnections(servingDb([sealedRow(newRing(), SERVER_A)]), null);
    expect(list.connections).toEqual([]);
    expect(list.unreadable).toEqual([{ serverId: SERVER_A, publicId: "srv", keyId: "k1" }]);
  });

  it("reports a modified value as unreadable, without its content", async () => {
    const ring = newRing();
    const row = sealedRow(ring, SERVER_A);
    const tampered = Buffer.from(row.api_token_enc);
    tampered[14] = tampered[14]! ^ 0x01;
    const list = await listConnections(servingDb([{ ...row, api_token_enc: tampered }]), ring);
    expect(list.connections).toEqual([]);
    expect(list.unreadable).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(API_TOKEN);
  });

  it("refuses a row whose shape drifted", async () => {
    const ring = newRing();
    await expect(listConnections(servingDb([sealedRow(ring, SERVER_A, { pinned_ip: "not-an-ip" })]), ring)).rejects.toThrow("Unexpected database row shape");
  });
});

describe("the sealing context binds a value to its row and field", () => {
  const unreadableOnly = async (ring: SecretsKeyring, row: unknown) => {
    const list = await listConnections(servingDb([row]), ring);
    expect(list.connections).toEqual([]);
    expect(list.unreadable).toHaveLength(1);
  };

  it("a row copied to another server does not open", async () => {
    const ring = newRing();
    await unreadableOnly(ring, { ...sealedRow(ring, SERVER_A), server_id: SERVER_B });
  });

  it("the API and FRM ciphertexts cannot be swapped", async () => {
    const ring = newRing();
    const row = sealedRow(ring, SERVER_A);
    await unreadableOnly(ring, { ...row, api_token_enc: row.frm_token_enc, frm_token_enc: row.api_token_enc });
  });

  it("uses the kind on the row, so a server flipped to another kind stops opening", async () => {
    const ring = newRing();
    await unreadableOnly(ring, sealedRow(ring, SERVER_A, { connection_kind: "agent" }));
  });
});

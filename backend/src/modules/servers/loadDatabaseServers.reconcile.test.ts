import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { saveConnection } from "./repositories/connectionRepository.js";
import type { ServerConnection } from "./repositories/connectionRepository.js";
import { connectionSource, reconcileDatabaseServers } from "./loadDatabaseServers.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

// ADR-0054 D3: during a deploy's overlap a server write reaches only one task's runtime. The task that becomes leader
// reloads from the database, changing only what differs.

const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const LAN_OK = { allowLan: true };
const base = { host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678" };

/** When the stored rows were last written, unless a test says otherwise; every real write sets it. */
const WRITTEN = "2026-10-26T00:00:00.000Z";

interface Stored {
  publicId: string;
  displayName?: string;
  apiToken?: string;
  /** The row's `updated_at`: an edit (a new token too) moves it. */
  updatedAt?: string;
  /** Sealed with another keyring: this process cannot open the row (unreadable). */
  sealedWith?: typeof ring;
  /** A stored address the policy refuses. */
  pinnedIp?: string;
}

/** A database holding these polled servers (sealed for real) and these agent servers. */
async function fakeDb(polled: Stored[], agents: { publicId: string; displayName: string }[] = []): Promise<Queryable> {
  const rows: unknown[] = [];
  for (const server of polled) {
    let written: unknown[] = [];
    const conn = { ...base, apiToken: server.apiToken ?? base.apiToken, pinnedIp: server.pinnedIp ?? base.pinnedIp };
    await saveConnection({ query: async (t, v = []) => { if (t.includes("INSERT INTO servers.server_connections")) written = v; return { rows: [{}] }; } }, server.sealedWith ?? ring, `uuid-${server.publicId}`, conn);
    const [, host, pinned, apiPort, frmPort, apiEnc, frmEnc, keyId] = written;
    rows.push({
      server_id: `uuid-${server.publicId}`, public_id: server.publicId, display_name: server.displayName ?? `Name ${server.publicId}`, connection_kind: "local",
      host, pinned_ip: pinned, api_port: apiPort, frm_port: frmPort, api_token_enc: apiEnc, frm_token_enc: frmEnc, key_id: keyId,
      updated_at: new Date(server.updatedAt ?? WRITTEN),
    });
  }
  return {
    async query(text) {
      if (text.includes("connection_kind = 'agent'")) {
        return { rows: agents.map((a) => ({ id: `uuid-${a.publicId}`, public_id: a.publicId, display_name: a.displayName })) };
      }
      return { rows };
    },
  };
}

const worker = () => ({ start: vi.fn(), stop: vi.fn(async () => undefined) });

/** The composition root's builder, in miniature: services name the token, and the source is the connection's digest. */
const build = (c: ServerConnection): RuntimeServer<string> => ({
  id: c.publicId,
  displayName: c.displayName,
  services: `polled:${c.apiToken}`,
  workers: [worker()],
  source: connectionSource(c),
  rebuild: (name) => ({ id: c.publicId, displayName: name, services: `polled:${c.apiToken}`, workers: [worker()] }),
});
const buildAgent = ({ publicId, displayName }: { publicId: string; displayName: string }): RuntimeServer<string> => ({
  id: publicId,
  displayName,
  services: `agent:${publicId}`,
  workers: [worker()],
  kind: "agent",
});
/** An entry as this task built it from the stored row (so with the row's `updatedAt`). */
const polledEntry = (publicId: string, apiToken = base.apiToken, displayName = `Name ${publicId}`, updatedAt: string | undefined = WRITTEN) =>
  build({ serverId: `uuid-${publicId}`, publicId, displayName, ...base, apiToken, updatedAt });

/** A running runtime that is the leader (pollers run), as when the lock is taken. */
function runningRuntime(entries: RuntimeServer<string>[]) {
  const runtime = new ServerRuntime(entries);
  runtime.start();
  return runtime;
}

const reconcile = (db: Queryable, runtime: ServerRuntime<string>) =>
  reconcileDatabaseServers({ db, ring, runtime, build, buildAgent, policy: LAN_OK });

describe("reconcileDatabaseServers (ADR-0054 D3)", () => {
  it("changes nothing when the runtime already matches: pollers keep running, an agent keeps its snapshots", async () => {
    const home = polledEntry("home");
    const friend = buildAgent({ publicId: "friend", displayName: "Friend" });
    const runtime = runningRuntime([home, friend]);
    const result = await reconcile(await fakeDb([{ publicId: "home" }], [{ publicId: "friend", displayName: "Friend" }]), runtime);
    expect(result).toMatchObject({ added: [], removed: [], replaced: [], renamed: [] });
    expect(home.workers[0]!.stop).not.toHaveBeenCalled();
    expect(friend.workers[0]!.stop).not.toHaveBeenCalled();
    expect(runtime.get("friend")).toBe("agent:friend");
  });

  it("adds a server created on the other task and starts its pollers", async () => {
    const runtime = runningRuntime([]);
    const result = await reconcile(await fakeDb([{ publicId: "new" }]), runtime);
    expect(result.added).toEqual(["new"]);
    expect(runtime.get("new")).toBe(`polled:${base.apiToken}`);
  });

  it("removes a server deleted on the other task and stops its pollers", async () => {
    const gone = polledEntry("gone");
    const runtime = runningRuntime([polledEntry("home"), gone]);
    const result = await reconcile(await fakeDb([{ publicId: "home" }]), runtime);
    expect(result.removed).toEqual(["gone"]);
    expect(runtime.has("gone")).toBe(false);
    expect(gone.workers[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("replaces a server whose connection was edited (a new token, so a new updated_at), and stops the old pollers", async () => {
    const old = polledEntry("home", "old-token-abcdefgh0000");
    const runtime = runningRuntime([old]);
    const result = await reconcile(await fakeDb([{ publicId: "home", apiToken: "new-token-abcdefgh9999", updatedAt: "2026-10-26T00:00:30.000Z" }]), runtime);
    expect(result.replaced).toEqual(["home"]);
    expect(runtime.get("home")).toBe("polled:new-token-abcdefgh9999");
    expect(old.workers[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("the source holds nothing derived from a token: the same row with another token compares equal only by its write time", () => {
    const a = connectionSource({ ...base, updatedAt: WRITTEN });
    expect(a).not.toContain(base.apiToken);
    expect(a).not.toContain(base.frmToken);
    expect(connectionSource({ ...base, updatedAt: "2026-10-26T00:00:30.000Z" })).not.toBe(a);
  });

  it("rebuilds, before its pollers start, an entry this task built from its own write (no updated_at yet)", async () => {
    // Built from the write's own input, which has no updated_at (a default parameter would fill one in, so build directly).
    const ownWrite = build({ serverId: "uuid-home", publicId: "home", displayName: "Name home", ...base });
    const runtime = new ServerRuntime([ownWrite], { leaderGated: true });
    runtime.start();
    const result = await reconcile(await fakeDb([{ publicId: "home" }]), runtime);
    expect(result.replaced).toEqual(["home"]);
    expect(runtime.describe("home")?.source).toBe(connectionSource({ ...base, updatedAt: WRITTEN }));
  });

  it("only renames a server whose name changed: its pollers keep running", async () => {
    const home = polledEntry("home");
    const runtime = runningRuntime([home]);
    const result = await reconcile(await fakeDb([{ publicId: "home", displayName: "Main base" }]), runtime);
    expect(result).toMatchObject({ renamed: ["home"], replaced: [] });
    expect(runtime.list()).toEqual([{ id: "home", displayName: "Main base" }]);
    expect(home.workers[0]!.stop).not.toHaveBeenCalled();
  });

  it("renames an agent server in place, keeping its in-memory data", async () => {
    const runtime = runningRuntime([buildAgent({ publicId: "friend", displayName: "Friend" })]);
    const result = await reconcile(await fakeDb([], [{ publicId: "friend", displayName: "Friend's factory" }]), runtime);
    expect(result.renamed).toEqual(["friend"]);
    expect(runtime.get("friend")).toBe("agent:friend");
    expect(runtime.list()).toEqual([{ id: "friend", displayName: "Friend's factory" }]);
  });

  it("follows an enrolment made on the other task: the polled server becomes an agent server", async () => {
    const home = polledEntry("home");
    const runtime = runningRuntime([home]);
    const result = await reconcile(await fakeDb([], [{ publicId: "home", displayName: "Name home" }]), runtime);
    expect(result.replaced).toEqual(["home"]);
    expect(runtime.describe("home")?.kind).toBe("agent");
    expect(home.workers[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("follows a switch back to local made on the other task, which a replace would refuse", async () => {
    const runtime = runningRuntime([buildAgent({ publicId: "home", displayName: "Name home" })]);
    const result = await reconcile(await fakeDb([{ publicId: "home" }]), runtime);
    expect(result.replaced).toEqual(["home"]);
    expect(runtime.describe("home")?.kind).toBeUndefined();
    expect(runtime.get("home")).toBe(`polled:${base.apiToken}`);
  });

  it("changes nothing when the database stores no servers at all, as at startup", async () => {
    const config = polledEntry("from-config");
    const runtime = runningRuntime([config]);
    const result = await reconcile(await fakeDb([]), runtime);
    expect(result).toMatchObject({ added: [], removed: [], replaced: [], renamed: [] });
    expect(runtime.has("from-config")).toBe(true);
  });

  it("removes the last server when the other task deleted it and the database now stores none (database mode)", async () => {
    const last = polledEntry("last");
    const runtime = runningRuntime([last, buildAgent({ publicId: "friend", displayName: "Friend" })]);
    const result = await reconcileDatabaseServers({ db: await fakeDb([]), ring, runtime, build, buildAgent, policy: LAN_OK, emptyMeansNone: true });
    expect(result.removed.sort()).toEqual(["friend", "last"]);
    expect(runtime.size).toBe(0);
    expect(last.workers[0]!.stop).toHaveBeenCalled();
  });

  it("an entry rebuilt by stepping down keeps its source, so the next term does not restart an unchanged server", async () => {
    const runtime = new ServerRuntime([polledEntry("home")], { leaderGated: true });
    runtime.start();
    await runtime.setLeader(true);
    await runtime.setLeader(false);
    const result = await reconcile(await fakeDb([{ publicId: "home" }]), runtime);
    expect(result.replaced).toEqual([]);
  });

  it("keeps a running server whose row this process cannot open right now, but removes one whose address is refused", async () => {
    const otherRing = createSecretsKeyring("k9", new Map([["k9", randomBytes(32)]]));
    const sealedAway = polledEntry("sealed");
    const unsafe = polledEntry("unsafe");
    const runtime = runningRuntime([sealedAway, unsafe]);
    const result = await reconcile(await fakeDb([{ publicId: "sealed", sealedWith: otherRing }, { publicId: "unsafe", pinnedIp: "8.8.8.8" }]), runtime);
    expect(result.unreadable.map((u) => u.publicId)).toEqual(["sealed"]);
    expect(runtime.has("sealed")).toBe(true);
    expect(sealedAway.workers[0]!.stop).not.toHaveBeenCalled();
    expect(result.refused.map((r) => r.publicId)).toEqual(["unsafe"]);
    expect(result.removed).toEqual(["unsafe"]);
  });
});

import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, ServerNotFoundError } from "../../platform/errorResponse.js";
import { createSecretsKeyring, SecretsError } from "../../platform/secrets/secrets.js";

// The repositories and the transaction helper are replaced, so this file tests the SERVICE's rules
// (order of checks, what is saved, what is refused, what the runtime does) without SQL. The real
// statements, the advisory lock and the cap under concurrency are in serverManagement.db.test.ts (CI).
const repo = vi.hoisted(() => ({
  countConnections: vi.fn(),
  createConnection: vi.fn(),
  getConnection: vi.fn(),
  getConnectionMetaByPublicId: vi.fn(),
  listConnectionMetas: vi.fn(),
  updateConnection: vi.fn(),
  addMember: vi.fn(),
  findServerByPublicId: vi.fn(),
  renameServer: vi.fn(),
  softDeleteServer: vi.fn(),
  upsertConfiguredServer: vi.fn(),
  recordAuditEvent: vi.fn(),
  clientQueries: [] as string[],
}));

vi.mock("./repositories/connectionRepository.js", () => ({
  countConnections: repo.countConnections,
  createConnection: repo.createConnection,
  getConnection: repo.getConnection,
  getConnectionMetaByPublicId: repo.getConnectionMetaByPublicId,
  listConnectionMetas: repo.listConnectionMetas,
  updateConnection: repo.updateConnection,
}));
vi.mock("./repositories/memberRepository.js", () => ({ addMember: repo.addMember }));
vi.mock("./repositories/serverRepository.js", () => ({
  findServerByPublicId: repo.findServerByPublicId,
  renameServer: repo.renameServer,
  softDeleteServer: repo.softDeleteServer,
  upsertConfiguredServer: repo.upsertConfiguredServer,
}));
vi.mock("../../platform/audit/auditRepository.js", () => ({ recordAuditEvent: repo.recordAuditEvent }));
vi.mock("../../platform/db/transaction.js", () => ({
  withTransaction: async (_pool: unknown, fn: (client: unknown) => Promise<unknown>) =>
    fn({ query: async (text: string) => { repo.clientQueries.push(text); return { rows: [] }; } }),
}));

const { createServerManagementService } = await import("./serverManagement.js");
const { ServerRuntime } = await import("./serverRuntime.js");

const OPERATOR = "operator-id";
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const API = "api-token-abcdefgh1234";
const FRM = "frm-token-abcdefgh5678";

const passed = { ok: true, api: { ok: true }, frm: { ok: true } };
const failed = { ok: false, api: { ok: false, error: "unreachable" as const }, frm: { ok: true } };

const meta = { serverId: "uuid-home", publicId: "home", displayName: "Home", host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, frmTokenSet: true, keyId: "k1" };

function setup(options: { ring?: typeof ring | null; lookup?: (host: string) => Promise<string[]>; test?: () => Promise<typeof passed | typeof failed>; envNames?: string[] } = {}) {
  const runtime = new ServerRuntime<string>([{ id: "home", displayName: "Home", services: "old", workers: [] }]);
  const build = vi.fn((c: { publicId: string; displayName: string }) => ({ id: c.publicId, displayName: c.displayName, services: "new", workers: [] }));
  const testConnection = vi.fn(options.test ?? (async () => passed));
  const service = createServerManagementService({
    db: { query: async () => ({ rows: [] }), connect: async () => ({}) } as never,
    ring: options.ring === undefined ? ring : options.ring,
    runtime,
    build,
    testConnection,
    getOperatorUserId: () => OPERATOR,
    configuredServerEnvNames: () => options.envNames ?? [],
    lookup: options.lookup ?? (async () => ["192.168.1.30"]),
  });
  return { service, runtime, build, testConnection };
}

const createInput = { id: "alt", displayName: "Alt", host: "gaming-pc.lan", apiPort: 7777, frmPort: 8080, apiToken: API, frmToken: FRM };

beforeEach(() => {
  for (const fn of Object.values(repo)) if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  repo.clientQueries.length = 0;
  repo.countConnections.mockResolvedValue(1);
  repo.findServerByPublicId.mockResolvedValue(undefined);
  repo.upsertConfiguredServer.mockResolvedValue({ id: "uuid-alt", publicId: "alt", displayName: "Alt", hostingMode: "self", connectionKind: "local" });
  repo.createConnection.mockResolvedValue("created");
  repo.addMember.mockResolvedValue("added");
  repo.getConnectionMetaByPublicId.mockResolvedValue(meta);
  repo.getConnection.mockResolvedValue({ ...meta, apiToken: API, frmToken: FRM });
  repo.updateConnection.mockResolvedValue(true);
  repo.renameServer.mockResolvedValue(true);
  repo.softDeleteServer.mockResolvedValue(true);
});

describe("canManage", () => {
  it("is true only for the operator account, and false before it is known", () => {
    expect(setup().service.canManage(OPERATOR)).toBe(true);
    expect(setup().service.canManage("someone-else")).toBe(false);
    const unknown = createServerManagementService({ db: {} as never, ring, runtime: new ServerRuntime<string>(), build: vi.fn() as never, testConnection: vi.fn(), getOperatorUserId: () => undefined });
    expect(unknown.canManage("anything")).toBe(false);
  });
});

describe("create", () => {
  it("resolves the host, tests, saves in one transaction under the advisory lock, then starts the server", async () => {
    const { service, runtime, build, testConnection } = setup();
    const view = await service.create(OPERATOR, createInput);
    // The test ran against the PINNED address, not the hostname.
    expect(testConnection).toHaveBeenCalledWith({ pinnedIp: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: API, frmToken: FRM });
    expect(repo.clientQueries[0]).toContain("pg_advisory_xact_lock");
    expect(repo.createConnection).toHaveBeenCalledWith(expect.anything(), ring, "uuid-alt", expect.objectContaining({ host: "gaming-pc.lan", pinnedIp: "192.168.1.30" }));
    expect(repo.addMember).toHaveBeenCalledWith(expect.anything(), { serverId: "uuid-alt", userId: OPERATOR, role: "owner", actorUserId: null });
    expect(repo.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), { action: "server.created", actorUserId: OPERATOR, serverId: "uuid-alt" });
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ publicId: "alt", pinnedIp: "192.168.1.30", apiToken: API }));
    expect(runtime.has("alt")).toBe(true);
    expect(view).toMatchObject({ id: "alt", host: "gaming-pc.lan", apiTokenSet: true, apiTokenLast4: "1234", frmTokenSet: true, frmTokenLast4: "5678", state: "ok", plainHttpOverLan: true });
    expect(JSON.stringify(view)).not.toContain(API);
    expect(JSON.stringify(view)).not.toContain(FRM);
  });

  it("does not warn about plain HTTP over the LAN for a loopback address", async () => {
    const { service } = setup({ lookup: async () => ["127.0.0.1"] });
    expect((await service.create(OPERATOR, { ...createInput, host: "localhost" })).plainHttpOverLan).toBe(false);
  });

  it.each([
    ["a public literal", "8.8.8.8", async () => []],
    ["the metadata address", "169.254.169.254", async () => []],
    ["a name that resolves to a public address", "public.example", async () => ["93.184.216.34"]],
    ["a name that resolves to a MIX (rebinding)", "mixed.example", async () => ["192.168.1.30", "8.8.8.8"]],
    ["a name that does not resolve", "gone.example", async () => Promise.reject(new Error("ENOTFOUND"))],
  ])("refuses %s with address_not_allowed, before any test connection or write", async (_label, host, lookup) => {
    const { service, testConnection, runtime } = setup({ lookup });
    const err = await service.create(OPERATOR, { ...createInput, host }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe("address_not_allowed");
    expect((err as ApiFailure).message).not.toMatch(/8\.8\.8\.8|169\.254|93\.184|192\.168/);
    expect(testConnection).not.toHaveBeenCalled();
    expect(repo.createConnection).not.toHaveBeenCalled();
    expect(runtime.has("alt")).toBe(false);
  });

  it("saves nothing when the connection test fails, and says which side (codes only)", async () => {
    const { service, runtime } = setup({ test: async () => failed });
    const err = await service.create(OPERATOR, createInput).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("connection_test_failed");
    expect((err as ApiFailure).message).toContain("API: unreachable");
    expect((err as ApiFailure).message).toContain("FRM: ok");
    expect(repo.upsertConfiguredServer).not.toHaveBeenCalled();
    expect(runtime.has("alt")).toBe(false);
  });

  it("refuses the ninth server (cap of 8) inside the transaction", async () => {
    repo.countConnections.mockResolvedValue(8);
    const { service, runtime } = setup();
    const err = await service.create(OPERATOR, createInput).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("server_limit_reached");
    expect(repo.createConnection).not.toHaveBeenCalled();
    expect(runtime.has("alt")).toBe(false);
  });

  it("refuses an id that is taken (409 server_exists), whether the row or the connection exists", async () => {
    repo.findServerByPublicId.mockResolvedValue({ id: "x" });
    expect(((await setup().service.create(OPERATOR, createInput).catch((e: unknown) => e)) as ApiFailure).code).toBe("server_exists");
    repo.findServerByPublicId.mockResolvedValue(undefined);
    repo.createConnection.mockResolvedValue("exists");
    expect(((await setup().service.create(OPERATOR, createInput).catch((e: unknown) => e)) as ApiFailure).code).toBe("server_exists");
  });

  it("without SERVER_SECRETS_KEY it is a 503-style service_unavailable, touching nothing", async () => {
    const { service, testConnection } = setup({ ring: null });
    const err = await service.create(OPERATOR, createInput).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("service_unavailable");
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("runs creates one at a time (the in-process mutex), so the cap and the runtime never race", async () => {
    let active = 0;
    let maxActive = 0;
    const { service } = setup({
      test: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return passed;
      },
    });
    repo.upsertConfiguredServer.mockImplementation(async (_db: unknown, input: { publicId: string }) => ({ id: `uuid-${input.publicId}`, publicId: input.publicId, displayName: "x" }));
    await Promise.all(["a1", "a2", "a3"].map((id) => service.create(OPERATOR, { ...createInput, id })));
    expect(maxActive).toBe(1);
  });
});

describe("update", () => {
  it("is a not-found for an unknown server", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue(undefined);
    await expect(setup().service.update(OPERATOR, "nope", { displayName: "x" })).rejects.toBeInstanceOf(ServerNotFoundError);
  });

  it("a rename alone does no lookup and no test, keeps the pollers running, and works even if the tokens cannot be opened", async () => {
    repo.getConnection.mockRejectedValue(new SecretsError("Could not decrypt a stored secret."));
    const { service, runtime, testConnection, build } = setup();
    const view = await service.update(OPERATOR, "home", { displayName: "Renamed" });
    expect(repo.renameServer).toHaveBeenCalledWith(expect.anything(), "home", "Renamed", { actorUserId: OPERATOR });
    expect(repo.updateConnection).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(runtime.list()).toEqual([{ id: "home", displayName: "Renamed" }]);
    expect(view).toMatchObject({ displayName: "Renamed", state: "unreadable" });
  });

  it("re-resolves the host on an edit and refuses a new host that is not allowed, saving nothing", async () => {
    const { service, testConnection, runtime } = setup({ lookup: async () => ["8.8.8.8"] });
    const err = await service.update(OPERATOR, "home", { host: "evil.example" }).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("address_not_allowed");
    expect(testConnection).not.toHaveBeenCalled();
    expect(repo.updateConnection).not.toHaveBeenCalled();
    expect(runtime.get("home")).toBe("old");
  });

  it("re-resolves even when only a port or a token changes (the stored host must still be allowed)", async () => {
    const { service } = setup({ lookup: async () => ["8.8.8.8"] });
    repo.getConnectionMetaByPublicId.mockResolvedValue({ ...meta, host: "moved.example" });
    const err = await service.update(OPERATOR, "home", { apiPort: 9999 }).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("address_not_allowed");
  });

  it("tests the MERGED connection (new API token, stored FRM token) before saving, then re-seals and swaps the running server", async () => {
    const { service, runtime, testConnection, build } = setup({ lookup: async () => ["192.168.1.20"] });
    const view = await service.update(OPERATOR, "home", { apiToken: "new-api-token-zzzz9999" });
    expect(testConnection).toHaveBeenCalledWith({ pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: "new-api-token-zzzz9999", frmToken: FRM });
    expect(repo.updateConnection).toHaveBeenCalledWith(expect.anything(), ring, "uuid-home", expect.objectContaining({ apiToken: "new-api-token-zzzz9999", pinnedIp: "192.168.1.20" }), { actorUserId: OPERATOR });
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ apiToken: "new-api-token-zzzz9999", frmToken: FRM }));
    expect(runtime.get("home")).toBe("new");
    expect(view).toMatchObject({ apiTokenLast4: "9999", frmTokenLast4: "5678", state: "ok" });
    expect(JSON.stringify(view)).not.toContain("new-api-token");
  });

  it("frmToken null clears the FRM token: the test and the running server have none", async () => {
    const { service, testConnection, build } = setup({ lookup: async () => ["192.168.1.20"] });
    const view = await service.update(OPERATOR, "home", { frmToken: null });
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ frmToken: undefined }));
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ frmToken: undefined }));
    expect(view).toMatchObject({ frmTokenSet: false, frmTokenLast4: null });
  });

  it("saves nothing and keeps the running server when the test fails", async () => {
    const { service, runtime, build } = setup({ lookup: async () => ["192.168.1.20"], test: async () => failed });
    const err = await service.update(OPERATOR, "home", { apiPort: 9999 }).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("connection_test_failed");
    expect(repo.updateConnection).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(runtime.get("home")).toBe("old");
  });

  describe("a row whose stored tokens cannot be opened (the repair path)", () => {
    beforeEach(() => {
      repo.getConnection.mockRejectedValue(new SecretsError("Could not decrypt a stored secret."));
    });

    it("asks for both tokens again (connection_unreadable) when the edit does not carry them", async () => {
      const { service } = setup({ lookup: async () => ["192.168.1.20"] });
      for (const patch of [{ apiPort: 9999 }, { apiToken: "new-api-token-zzzz9999" }, { frmToken: "new-frm-token-yyyy8888" }]) {
        const err = await service.update(OPERATOR, "home", patch).catch((e: unknown) => e);
        expect((err as ApiFailure).code).toBe("connection_unreadable");
      }
      expect(repo.updateConnection).not.toHaveBeenCalled();
    });

    it("repairs it when both tokens are sent (the FRM token may be null), testing with the new ones", async () => {
      const { service, testConnection, runtime } = setup({ lookup: async () => ["192.168.1.20"] });
      const view = await service.update(OPERATOR, "home", { apiToken: "new-api-token-zzzz9999", frmToken: null });
      expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ apiToken: "new-api-token-zzzz9999", frmToken: undefined }));
      expect(repo.updateConnection).toHaveBeenCalled();
      expect(runtime.get("home")).toBe("new");
      expect(view.state).toBe("ok");
    });
  });
});

describe("remove", () => {
  it("is a not-found for an unknown server, touching nothing", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue(undefined);
    const { service, runtime } = setup();
    await expect(service.remove(OPERATOR, "nope")).rejects.toBeInstanceOf(ServerNotFoundError);
    expect(runtime.has("home")).toBe(true);
  });

  it("wipes the row (tokens and memberships, audited) and then stops the pollers", async () => {
    const { service, runtime } = setup();
    await service.remove(OPERATOR, "home");
    expect(repo.softDeleteServer).toHaveBeenCalledWith(expect.anything(), "home", { actorUserId: OPERATOR });
    expect(runtime.has("home")).toBe(false);
  });

  it("keeps the running server when the database says it was already removed", async () => {
    repo.softDeleteServer.mockResolvedValue(false);
    const { service, runtime } = setup();
    await expect(service.remove(OPERATOR, "home")).rejects.toBeInstanceOf(ServerNotFoundError);
    expect(runtime.has("home")).toBe(true);
  });
});

describe("get", () => {
  it("shows set flags and the last 4 characters, never a token", async () => {
    const view = await setup().service.get("home");
    expect(view).toEqual({
      id: "home", displayName: "Home", host: "192.168.1.20", apiPort: 7777, frmPort: 8080,
      apiTokenSet: true, apiTokenLast4: "1234", frmTokenSet: true, frmTokenLast4: "5678", state: "ok", plainHttpOverLan: true,
    });
  });

  it("shows no suffix for a short token", async () => {
    repo.getConnection.mockResolvedValue({ ...meta, apiToken: "short-tok", frmToken: undefined });
    repo.getConnectionMetaByPublicId.mockResolvedValue({ ...meta, frmTokenSet: false });
    expect(await setup().service.get("home")).toMatchObject({ apiTokenLast4: null, frmTokenSet: false, frmTokenLast4: null });
  });

  it("reports an unreadable row as such (host and ports still shown, no suffixes)", async () => {
    repo.getConnection.mockRejectedValue(new SecretsError("Could not decrypt a stored secret."));
    expect(await setup().service.get("home")).toMatchObject({ host: "192.168.1.20", state: "unreadable", apiTokenLast4: null, frmTokenLast4: null, frmTokenSet: true });
  });

  it("is a not-found for an unknown server", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue(undefined);
    await expect(setup().service.get("nope")).rejects.toBeInstanceOf(ServerNotFoundError);
  });
});

describe("testCandidate and testSaved", () => {
  it("testCandidate pins the host and tests that address, and refuses a host that is not allowed", async () => {
    const { service, testConnection } = setup();
    expect(await service.testCandidate({ host: "gaming-pc.lan", apiPort: 7777, frmPort: 8080, apiToken: API })).toEqual(passed);
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ pinnedIp: "192.168.1.30" }));
    const err = await setup({ lookup: async () => ["10.0.0.5", "1.1.1.1"] }).service.testCandidate({ host: "mixed.example", apiPort: 1, frmPort: 2, apiToken: API }).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("address_not_allowed");
  });

  it("testSaved re-checks that the host is still allowed, then tests the STORED pinned address with the stored tokens", async () => {
    const { service, testConnection } = setup({ lookup: async () => ["192.168.1.99"] });
    repo.getConnectionMetaByPublicId.mockResolvedValue({ ...meta, host: "gaming-pc.lan" });
    await service.testSaved("home");
    expect(testConnection).toHaveBeenCalledWith({ pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API, frmToken: FRM });
    const refused = await setup({ lookup: async () => ["8.8.8.8"] }).service.testSaved("home").catch((e: unknown) => e);
    expect((refused as ApiFailure).code).toBe("address_not_allowed");
  });

  it("testSaved on an unreadable row is connection_unreadable, not a 500", async () => {
    repo.getConnection.mockRejectedValue(new SecretsError("Could not decrypt a stored secret."));
    const err = await setup().service.testSaved("home").catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("connection_unreadable");
  });
});

describe("the management list and the states (unreadable, refused)", () => {
  const stranded = { ...meta, serverId: "uuid-stranded", publicId: "stranded", displayName: "Stranded" };
  const tampered = { ...meta, serverId: "uuid-tampered", publicId: "tampered", displayName: "Tampered", pinnedIp: "8.8.8.8" };

  it("lists every stored connection with its state: ok, unreadable and refused", async () => {
    repo.listConnectionMetas.mockResolvedValue([meta, stranded, tampered]);
    repo.getConnection.mockImplementation(async (_db: unknown, _ring: unknown, serverId: string) => {
      if (serverId === "uuid-stranded") throw new SecretsError("Could not decrypt a stored secret.");
      return { ...meta, apiToken: API, frmToken: FRM };
    });
    const views = await setup().service.list();
    expect(views.map((v) => [v.id, v.state])).toEqual([["home", "ok"], ["stranded", "unreadable"], ["tampered", "refused"]]);
    expect(views[0]).toMatchObject({ apiTokenLast4: "1234", frmTokenLast4: "5678" });
    expect(views[1]).toMatchObject({ apiTokenLast4: null, frmTokenLast4: null, host: "192.168.1.20", apiPort: 7777 });
    expect(views[2]).toMatchObject({ apiTokenLast4: null, frmTokenLast4: null });
    expect(JSON.stringify(views)).not.toContain(API);
    expect(JSON.stringify(views)).not.toContain(FRM);
  });

  it("never opens the tokens of a refused row", async () => {
    repo.listConnectionMetas.mockResolvedValue([tampered]);
    await setup().service.list();
    expect(repo.getConnection).not.toHaveBeenCalled();
  });

  it("with no keyring every row is unreadable (still listed), and refused stays refused", async () => {
    repo.listConnectionMetas.mockResolvedValue([meta, tampered]);
    const views = await setup({ ring: null }).service.list();
    expect(views.map((v) => v.state)).toEqual(["unreadable", "refused"]);
    expect(repo.getConnection).not.toHaveBeenCalled();
  });

  it("a rename alone of a refused row stays refused and never opens its tokens", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue(tampered);
    const view = await setup().service.update(OPERATOR, "tampered", { displayName: "New" });
    expect(view).toMatchObject({ state: "refused", displayName: "New", apiTokenLast4: null });
    expect(repo.getConnection).not.toHaveBeenCalled();
  });

  it("is empty when nothing is stored", async () => {
    repo.listConnectionMetas.mockResolvedValue([]);
    expect(await setup().service.list()).toEqual([]);
  });

  it("get reports refused too, and works without a keyring", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue(tampered);
    expect((await setup().service.get("tampered")).state).toBe("refused");
    repo.getConnectionMetaByPublicId.mockResolvedValue(meta);
    expect((await setup({ ring: null }).service.get("home")).state).toBe("unreadable");
  });

  it("testSaved refuses to connect to a stored address that is not allowed (no test is run)", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue({ ...tampered, host: "192.168.1.20" });
    const { service, testConnection } = setup({ lookup: async () => ["192.168.1.20"] });
    const err = await service.testSaved("tampered").catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("address_not_allowed");
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("a refused row can be repaired by editing the host: it is re-resolved and re-pinned", async () => {
    repo.getConnectionMetaByPublicId.mockResolvedValue({ ...tampered, host: "192.168.1.20" });
    const { service, runtime } = setup({ lookup: async () => ["192.168.1.20"] });
    const view = await service.update(OPERATOR, "tampered", { host: "gaming-pc.lan" });
    expect(repo.updateConnection).toHaveBeenCalledWith(expect.anything(), ring, "uuid-tampered", expect.objectContaining({ pinnedIp: "192.168.1.20" }), expect.anything());
    expect(view.state).toBe("ok");
    expect(runtime.has("tampered")).toBe(true);
  });
});

describe("remove without a keyring, and create before the import", () => {
  it("removes an unreadable or keyless row (no keyring is needed)", async () => {
    const { service, runtime } = setup({ ring: null });
    await service.remove(OPERATOR, "home");
    expect(repo.softDeleteServer).toHaveBeenCalledWith(expect.anything(), "home", { actorUserId: OPERATOR });
    expect(runtime.has("home")).toBe(false);
  });

  it("create is refused with import_required while servers still come from the environment and none is stored", async () => {
    repo.countConnections.mockResolvedValue(0);
    const { service, testConnection } = setup({ envNames: ["SATISFACTORY_SERVER_HOST"] });
    const err = await service.create(OPERATOR, createInput).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("import_required");
    expect((err as ApiFailure).message).toContain("import-servers");
    expect(testConnection).not.toHaveBeenCalled();
    expect(repo.upsertConfiguredServer).not.toHaveBeenCalled();
  });

  it("re-checks the import gate under the advisory lock (an import that lands after the early check is not missed)", async () => {
    // Early check sees a stored connection (an import just landed), the locked count sees none: the locked one decides.
    repo.countConnections.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const { service } = setup({ envNames: ["SATISFACTORY_SERVER_HOST"] });
    const err = await service.create(OPERATOR, createInput).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("import_required");
    expect(repo.clientQueries[0]).toContain("pg_advisory_xact_lock");
    expect(repo.createConnection).not.toHaveBeenCalled();
  });

  it("a rename alone works without a keyring (it re-seals nothing)", async () => {
    const { service } = setup({ ring: null });
    expect(await service.update(OPERATOR, "home", { displayName: "Renamed" })).toMatchObject({ displayName: "Renamed", state: "unreadable" });
    const err = await setup({ ring: null }).service.update(OPERATOR, "home", { apiPort: 9999 }).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe("service_unavailable");
  });

  it("create is allowed once something is stored (the database already wins), or when nothing is configured in the environment", async () => {
    repo.countConnections.mockResolvedValue(1);
    await expect(setup({ envNames: ["SATISFACTORY_SERVER_HOST"] }).service.create(OPERATOR, createInput)).resolves.toMatchObject({ id: "alt" });
    repo.countConnections.mockResolvedValue(0);
    await expect(setup({ envNames: [] }).service.create(OPERATOR, { ...createInput, id: "alt2" })).resolves.toMatchObject({ id: "alt2" });
  });
});

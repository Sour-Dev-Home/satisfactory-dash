import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerNotFoundError } from "../../platform/errorResponse.js";

// The repositories are replaced, so this file tests the SERVICE's rules (what is looked up, what is written, what the
// runtime does) without SQL. The real statements are in serverManagement.db.test.ts. Since ADR-0066 the service lists,
// renames and removes servers; adding, editing, testing and switching a direct-poll server are gone.
const repo = vi.hoisted(() => ({
  findServerByPublicId: vi.fn(),
  listOperatorAgentServers: vi.fn(),
  renameServer: vi.fn(),
  softDeleteServer: vi.fn(),
}));

vi.mock("./repositories/serverRepository.js", () => ({
  findServerByPublicId: repo.findServerByPublicId,
  listOperatorAgentServers: repo.listOperatorAgentServers,
  renameServer: repo.renameServer,
  softDeleteServer: repo.softDeleteServer,
}));

const { createServerManagementService } = await import("./serverManagement.js");
const { ServerRuntime } = await import("./serverRuntime.js");

const OPERATOR = "operator-id";
const agentRow = { id: "uuid-agent", publicId: "alex", displayName: "Alex", hostingMode: "self", connectionKind: "agent" as const };

function setup() {
  const runtime = new ServerRuntime<string>([{ id: "alex", displayName: "Alex", services: "agent", workers: [], kind: "agent" }]);
  const service = createServerManagementService({
    db: { query: async () => ({ rows: [] }), connect: async () => ({}) } as never,
    runtime,
    getOperatorUserId: () => OPERATOR,
  });
  return { service, runtime };
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.findServerByPublicId.mockResolvedValue(agentRow);
  repo.renameServer.mockResolvedValue(true);
  repo.softDeleteServer.mockResolvedValue(true);
});

describe("canManage", () => {
  it("is true only for the operator account, and false before it is known", () => {
    expect(setup().service.canManage(OPERATOR)).toBe(true);
    expect(setup().service.canManage("someone-else")).toBe(false);
    const unknown = createServerManagementService({ db: {} as never, runtime: new ServerRuntime<string>(), getOperatorUserId: () => undefined });
    expect(unknown.canManage("anything")).toBe(false);
  });
});

describe("the operator's servers (ADR-0031; ADR-0066: every server is reached through the mod)", () => {
  it("lists them in the contract's shape: id, name and kind `agent`, no connection field", async () => {
    repo.listOperatorAgentServers.mockResolvedValue([{ publicId: "alex", displayName: "Alex" }, { publicId: "bo", displayName: "Bo" }]);
    expect(await setup().service.listAgentServers()).toEqual([
      { id: "alex", displayName: "Alex", kind: "agent" },
      { id: "bo", displayName: "Bo", kind: "agent" },
    ]);
  });

  it("renames one: saved with the operator as the actor and the running entry renamed in place", async () => {
    const { service, runtime } = setup();
    expect(await service.renameAgentServer(OPERATOR, "alex", "Alex's factory")).toEqual({ id: "alex", displayName: "Alex's factory", kind: "agent" });
    expect(repo.renameServer).toHaveBeenCalledWith(expect.anything(), "alex", "Alex's factory", { actorUserId: OPERATOR });
    expect(runtime.list().find((server) => server.id === "alex")?.displayName).toBe("Alex's factory");
    expect(runtime.get("alex")).toBe("agent"); // the agent runtime is untouched
  });

  it("renames a leftover `local` row the same way: it is an agent server awaiting the mod (ADR-0066 Decision 7)", async () => {
    repo.findServerByPublicId.mockResolvedValue({ ...agentRow, connectionKind: "local" as const });
    await expect(setup().service.renameAgentServer(OPERATOR, "alex", "X")).resolves.toEqual({ id: "alex", displayName: "X", kind: "agent" });
  });

  it("an unknown id and a server that vanished meanwhile are the same not-found", async () => {
    const { service } = setup();
    repo.findServerByPublicId.mockResolvedValue(undefined);
    expect(await service.renameAgentServer(OPERATOR, "nope", "X").catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
    repo.findServerByPublicId.mockResolvedValue(agentRow);
    repo.renameServer.mockResolvedValue(false);
    expect(await service.renameAgentServer(OPERATOR, "alex", "X").catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
    expect(repo.renameServer).toHaveBeenCalledTimes(1); // only the second case got as far as writing
  });
});

describe("remove", () => {
  it("is a not-found for an unknown server, touching nothing", async () => {
    repo.findServerByPublicId.mockResolvedValue(undefined);
    const { service, runtime } = setup();
    await expect(service.remove(OPERATOR, "nope")).rejects.toBeInstanceOf(ServerNotFoundError);
    expect(repo.softDeleteServer).not.toHaveBeenCalled();
    expect(runtime.has("alex")).toBe(true);
  });

  it("removes an agent server, which has no stored connection (it used to be looked up by its connection, a 404): audited soft delete, then its workers stop", async () => {
    const { service, runtime } = setup();
    await service.remove(OPERATOR, "alex");
    expect(repo.softDeleteServer).toHaveBeenCalledWith(expect.anything(), "alex", { actorUserId: OPERATOR });
    expect(runtime.has("alex")).toBe(false);
  });

  it("keeps the running server when the database says it was already removed", async () => {
    repo.softDeleteServer.mockResolvedValue(false);
    const { service, runtime } = setup();
    await expect(service.remove(OPERATOR, "alex")).rejects.toBeInstanceOf(ServerNotFoundError);
    expect(runtime.has("alex")).toBe(true);
  });
});

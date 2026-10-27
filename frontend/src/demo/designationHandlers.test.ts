import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endpoints,
  PlannerDesignationsResponseSchema,
  ProductionGraphResponseSchema,
  ReplacePlannerDesignationsResponseSchema,
  type ReplacePlannerDesignationsRequest,
} from "@satisfactory-dash/shared";
import { factoryModels } from "../planner/graph/hierarchy";
import { membersOf, placesOf } from "../planner/designationMatch";
import { dissolveRequest, mergeRequest, undoRequest } from "../planner/designationOps";
import { factoriesConnected } from "../planner/connectivity";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import * as world from "./world";

// ADR-0055 #727: the demo keeps designations in memory, so merge, split, dissolve and undo show on its planner.

const SERVER = world.DEMO_SERVER_ID;
const send = (method: string, path: string, body?: unknown) =>
  transport(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const list = async () => PlannerDesignationsResponseSchema.parse(await (await send("GET", endpoints.plannerDesignations.list.path(SERVER))).json());
const graph = async () => ProductionGraphResponseSchema.parse(await (await send("GET", endpoints.productionGraph.path(SERVER))).json()).data;
const replace = (body: ReplacePlannerDesignationsRequest) => send("POST", endpoints.plannerDesignations.replace.path(SERVER), body);

beforeEach(async () => {
  resetDemoState();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("the demo must not use the network"))));
  await send("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });
});
afterEach(() => vi.unstubAllGlobals());

describe("the demo's designations", () => {
  it("lists the plastic line with a revision and every member found", async () => {
    const { designations, matches } = await list();
    expect(designations.map((d) => [d.name, d.revision])).toEqual([["Plastic line", 1]]);
    expect(matches[0]!.missing).toBe(0);
    expect(matches[0]!.memberBuildingIds).toEqual(designations[0]!.members.map((m) => m.id));
  });

  it("merges the two connected iron factories into one designated factory, and Split back restores the graph", async () => {
    const before = await graph();
    const models = factoryModels(before);
    const iron = models.filter((m) => m.factory.designationId === null);
    expect(iron).toHaveLength(2);
    expect(factoriesConnected(before, iron.map((m) => m.factory.key))).toBe(true);
    const places = placesOf(world.factory(world.DEMO_EPOCH).data.buildings);
    const suggested = iron.map((m) => {
      const made = membersOf(m.nodes, places);
      if (!made.ok) throw new Error(made.reason);
      return made.members;
    });
    const op = mergeRequest({ designations: [], suggested, name: "Iron works" });
    if (!op.ok) throw new Error(op.reason);
    const res = await replace(op.request);
    expect(res.status).toBe(200);
    const answer = ReplacePlannerDesignationsResponseSchema.parse(await res.json());
    const after = await graph();
    expect(after.factories!.map((f) => f.name)).toEqual(["Plastic line", "Iron works"]);
    expect(after.factories![1]!.nodeKeys.length).toBe(iron.reduce((sum, m) => sum + m.nodes.length, 0));
    const undo = undoRequest(op.preImage, answer);
    if (!undo.ok) throw new Error(undo.reason);
    expect((await replace(undo.request)).status).toBe(200);
    expect((await graph()).factories!.map((f) => f.name).sort()).toEqual(before.factories!.map((f) => f.name).sort());
  });

  it("dissolves the plastic line into an automatic factory, and answers a stale repeat with 409", async () => {
    const [plastic] = (await list()).designations;
    const op = dissolveRequest(plastic!);
    if (!op.ok) throw new Error(op.reason);
    expect((await replace(op.request)).status).toBe(200);
    const names = (await graph()).factories!.map((f) => [f.name, f.designationId]);
    expect(names).toContainEqual(["Plastic factory", null]);
    const again = await replace(op.request);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "designation_stale" } });
  });

  it("refuses a building the plastic line holds with designation_overlap naming it, and a bad body with 400", async () => {
    const [plastic] = (await list()).designations;
    const res = await send("POST", endpoints.plannerDesignations.create.path(SERVER), { name: "Grab", mode: "core", members: plastic!.members.slice(0, 1) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "designation_overlap", other: { id: plastic!.id, name: "Plastic line" } } });
    expect((await replace({ expect: [], put: [] })).status).toBe(400);
  });

  it("renames in memory, and a reset starts over", async () => {
    const [plastic] = (await list()).designations;
    const res = await send("PUT", endpoints.plannerDesignations.update.path(SERVER, plastic!.id), { name: "Polymer row" });
    expect(res.status).toBe(200);
    expect((await list()).designations[0]).toMatchObject({ name: "Polymer row", revision: 2 });
    resetDemoState();
    await send("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });
    expect((await list()).designations[0]).toMatchObject({ name: "Plastic line", revision: 1 });
  });
});

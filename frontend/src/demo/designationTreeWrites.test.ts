import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endpoints,
  PlannerDesignationsResponseSchema,
  ProductionGraphResponseSchema,
  type PlannerDesignation,
  type ReplacePlannerDesignationsRequest,
} from "@satisfactory-dash/shared";
import { dissolveRequest, groupRequest, moveRequest, ungroupRequest, undoRequest, type OpResult } from "../planner/designationOps";
import { buildFactoryTree, designatedKeyOf } from "../planner/factoryTree";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import * as world from "./world";

// ADR-0061 build PR 6: the demo's writes (ungroup, move, group, dissolve) on the nested seed keep the graph and the list
// consistent: one owner per group, a factory's parent as the list names it, no dangling parent.

const SERVER = world.DEMO_SERVER_ID;
const tree = world.DEMO_TREE;
const send = (method: string, path: string, body?: unknown) =>
  transport(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const listAll = async () => PlannerDesignationsResponseSchema.parse(await (await send("GET", endpoints.plannerDesignations.list.path(SERVER))).json());
const list = async () => (await listAll()).designations;
const graph = async () => ProductionGraphResponseSchema.parse(await (await send("GET", endpoints.productionGraph.path(SERVER))).json()).data;
const replace = (body: ReplacePlannerDesignationsRequest) => send("POST", endpoints.plannerDesignations.replace.path(SERVER), body);

const run = async (op: OpResult) => {
  if (!op.ok) throw new Error(op.reason);
  const res = await replace(op.request);
  expect(res.status).toBe(200);
  return op.request;
};
const byId = (all: readonly PlannerDesignation[], id: string) => {
  const d = all.find((x) => x.id === id);
  if (d === undefined) throw new Error(`no designation ${id}`);
  return d;
};

/** What must hold after any write on the nested seed. */
async function expectConsistent() {
  const designations = await list();
  const g = await graph();
  const ids = new Set(designations.map((d) => d.id));
  for (const d of designations) if (d.parentId != null) expect(ids.has(d.parentId)).toBe(true);
  const held = designations.flatMap((d) => d.members.map((m) => m.id));
  expect(new Set(held).size).toBe(held.length);
  const factories = g.factories!;
  const owned = factories.flatMap((f) => f.nodeKeys);
  expect(new Set(owned).size).toBe(owned.length);
  expect([...owned].sort()).toEqual(g.nodes.map((n) => n.key).sort());
  const parentOf = new Map(designations.map((d) => [d.id, d.parentId ?? null]));
  for (const f of factories) {
    expect(f.nodeKeys.length).toBeGreaterThan(0);
    if (f.designationId === null) expect(f.parentDesignationId ?? null).toBeNull();
    else expect(f.parentDesignationId ?? null).toBe(parentOf.get(f.designationId));
  }
  const home = new Map(g.nodes.map((n) => [n.key, n.factoryKey]));
  for (const n of g.nodes) {
    expect(factories.some((f) => f.key === n.factoryKey)).toBe(true);
    if (typeof n.collapseUnder === "string") expect(home.get(n.collapseUnder)).toBe(n.factoryKey);
    if (n.shares) expect(n.shares.map((s) => s.factoryKey)).toContain(n.factoryKey);
  }
  // The client's tree builds from it without losing a factory.
  const built = buildFactoryTree(g, designations);
  for (const f of factories) expect(built.nodes.has(f.key)).toBe(true);
  return { designations, g };
}

beforeEach(async () => {
  resetDemoState();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("the demo must not use the network"))));
  await send("POST", endpoints.auth.login.path(), { username: "demo", password: "demo" });
});
afterEach(() => vi.unstubAllGlobals());

describe("the demo's writes on the nested seed", () => {
  it("starts consistent", async () => {
    await expectConsistent();
  });

  it("ungroups Components (no machines of its own): its factories move up to Main base and it goes", async () => {
    const all = await list();
    await run(ungroupRequest({ all, parent: byId(all, tree.components.id) }));
    const { designations } = await expectConsistent();
    expect(designations.some((d) => d.id === tree.components.id)).toBe(false);
    expect(byId(designations, tree.plates.id).parentId).toBe(tree.mainBase.id);
    expect(byId(designations, tree.rods.id).parentId).toBe(tree.mainBase.id);
  });

  it("ungroups Main base (it owns machines): it stays, its areas go to the top level", async () => {
    const all = await list();
    await run(ungroupRequest({ all, parent: byId(all, tree.mainBase.id) }));
    const { designations, g } = await expectConsistent();
    expect(byId(designations, tree.mainBase.id).members).toHaveLength(2);
    expect(byId(designations, tree.smelting.id).parentId ?? null).toBeNull();
    expect(byId(designations, tree.components.id).parentId ?? null).toBeNull();
    expect(g.factories!.find((f) => f.designationId === tree.mainBase.id)?.parentDesignationId ?? null).toBeNull();
  });

  it("moves Rods and screws and Reinforced plates to the top: Components, left empty, goes too", async () => {
    const all = await list();
    await run(moveRequest({ all, picks: [{ designation: byId(all, tree.plates.id) }, { designation: byId(all, tree.rods.id) }], to: null }));
    const { designations } = await expectConsistent();
    expect(designations.some((d) => d.id === tree.components.id)).toBe(false);
    expect(byId(designations, tree.plates.id).parentId ?? null).toBeNull();
  });

  it("moves Smelting into Components (three levels still: Main base > Components > Smelting)", async () => {
    const all = await list();
    await run(moveRequest({ all, picks: [{ designation: byId(all, tree.smelting.id) }], to: tree.components.id }));
    const { designations } = await expectConsistent();
    expect(byId(designations, tree.smelting.id).parentId).toBe(tree.components.id);
  });

  it("refuses a group that would nest a fourth level, and a move of Main base under its own child", async () => {
    const all = await list();
    const grouped = groupRequest({
      all,
      picks: [{ designation: byId(all, tree.smelting.id) }, { designation: byId(all, tree.components.id) }],
      name: "Works",
      parentId: tree.mainBase.id,
      newId: "6f1c2a4e-3b5d-4c7a-9e1f-0a2b3c4d5e99",
    });
    expect(grouped.ok).toBe(false);
    expect(moveRequest({ all, picks: [{ designation: byId(all, tree.mainBase.id) }], to: tree.plates.id }).ok).toBe(false);
  });

  it("dissolves a leaf (Smelting): its machines go automatic and the miners and platforms still have one owner", async () => {
    const all = await list();
    await run(dissolveRequest(byId(all, tree.smelting.id), all));
    const { designations, g } = await expectConsistent();
    expect(designations.some((d) => d.id === tree.smelting.id)).toBe(false);
    const automatic = g.factories!.filter((f) => f.designationId === null);
    expect(automatic.length).toBeGreaterThan(0);
    // The miners follow the automatic smelters now, not the plates or Main base.
    const smelters = g.nodes.filter((n) => n.machineIds.some((id) => tree.smelting.machines.includes(id as never)));
    const miners = g.nodes.filter((n) => n.className.startsWith("Build_Miner"));
    expect(miners.length).toBeGreaterThan(0);
    for (const m of miners) expect(m.factoryKey).toBe(smelters[0]!.factoryKey);
  });

  it("dissolves a parent that owns machines (Main base): its areas rise to the top level, its machines go automatic", async () => {
    const all = await list();
    await run(dissolveRequest(byId(all, tree.mainBase.id), all));
    const { designations } = await expectConsistent();
    expect(designations.some((d) => d.id === tree.mainBase.id)).toBe(false);
    expect(byId(designations, tree.smelting.id).parentId ?? null).toBeNull();
    expect(byId(designations, tree.components.id).parentId ?? null).toBeNull();
  });

  it("dissolves a parent that owns none (Components): its factories rise to Main base", async () => {
    const all = await list();
    await run(dissolveRequest(byId(all, tree.components.id), all));
    const { designations } = await expectConsistent();
    expect(byId(designations, tree.plates.id).parentId).toBe(tree.mainBase.id);
  });

  it("dissolves every leaf in turn without leaving an owner-less group or a dangling parent", async () => {
    for (const key of ["plates", "rods", "smelting"] as const) {
      const all = await list();
      await run(dissolveRequest(byId(all, tree[key].id), all));
      await expectConsistent();
    }
    // Main base is the only designation left in the tree: it keeps its own machines and the groups nobody else holds.
    const { designations, g } = await expectConsistent();
    expect(designations.map((d) => d.name)).toEqual(["Plastic line", "Main base"]);
    expect(g.factories!.some((f) => f.designationId === tree.mainBase.id)).toBe(true);
  });

  it("undoes an ungroup back to the seeded tree", async () => {
    const all = await list();
    const parent = byId(all, tree.components.id);
    const op = ungroupRequest({ all, parent });
    if (!op.ok) throw new Error(op.reason);
    const res = await replace(op.request);
    const back = undoRequest(op.preImage, (await res.json()) as never);
    await run(back);
    const { designations, g } = await expectConsistent();
    expect(byId(designations, tree.plates.id).parentId).toBe(tree.components.id);
    expect(g.factories!.find((f) => f.key === designatedKeyOf(tree.plates.id))?.parentDesignationId).toBe(tree.components.id);
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { DesignationOverlapErrorSchema, PLANNER_DESIGNATIONS_MAX_PER_SERVER, PlannerDesignationsResponseSchema, ReplacePlannerDesignationsResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { PlannerDesignation } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createDesignationRoutes } from "./designationRoutes.js";
import type { DesignationStore } from "../repositories/designationRepository.js";
import { checkHierarchy, emptiedAncestors } from "../services/designationHierarchy.js";
import type { HierarchyNode } from "../services/designationHierarchy.js";
import { findOverlap } from "../services/designationMatching.js";
import type { DesignationBuilding } from "../services/designationMatching.js";

const nodeOf = (d: PlannerDesignation): HierarchyNode => ({ id: d.id, parentId: d.parentId ?? null, memberCount: d.members.length });

/** A store in memory with the database store's rules (cap, overlap, hierarchy), so the routes are tested against real outcomes. */
function memoryStore(): DesignationStore & { rows: PlannerDesignation[] } {
  const rows: PlannerDesignation[] = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 25, 10, 0, tick++)).toISOString();
  return {
    rows,
    list: async () => [...rows],
    create: async (_server, input) => {
      if (rows.length >= PLANNER_DESIGNATIONS_MAX_PER_SERVER) return { kind: "cap" };
      const other = findOverlap(input.members, rows);
      if (other) return { kind: "overlap", other };
      const parentId = input.parentId ?? null;
      const breach = checkHierarchy([...rows.map(nodeOf), { id: "", parentId, memberCount: input.members.length }]);
      if (breach) return breach;
      const at = stamp();
      const designation: PlannerDesignation = { id: randomUUID(), name: input.name, mode: input.mode, members: input.members, createdAt: at, updatedAt: at, revision: 1, parentId };
      rows.push(designation);
      return { kind: "created", designation };
    },
    update: async (_server, id, input) => {
      const current = rows.find((d) => d.id === id);
      if (!current) return { kind: "not_found" };
      if (input.members) {
        const other = findOverlap(input.members, rows.filter((d) => d.id !== id));
        if (other) return { kind: "overlap", other };
      }
      Object.assign(current, { name: input.name ?? current.name, members: input.members ?? current.members, updatedAt: stamp(), revision: (current.revision ?? 1) + 1 });
      return { kind: "updated", designation: current };
    },
    remove: async (_server, id) => {
      const target = rows.find((d) => d.id === id);
      if (!target) return false;
      const gone = new Set([id, ...emptiedAncestors(rows.map(nodeOf), id)]);
      for (const child of rows.filter((d) => d.parentId === id)) Object.assign(child, { parentId: target.parentId ?? null, updatedAt: stamp(), revision: (child.revision ?? 1) + 1 });
      rows.splice(0, rows.length, ...rows.filter((d) => !gone.has(d.id)));
      return true;
    },
    // The database store's replace rules, in memory (its own tests are designationRepository.db.test.ts).
    replace: async (_server, input) => {
      if (input.put.some((p) => p.createdAt !== undefined && Date.parse(p.createdAt) > Date.now())) return { kind: "created_in_future" };
      const expectIds = new Set(input.expect.map((e) => e.id));
      const stale = input.expect.filter((e) => rows.find((d) => d.id === e.id)?.revision !== e.revision);
      const taken = input.put.filter((p) => p.id !== undefined && !expectIds.has(p.id) && rows.some((d) => d.id === p.id));
      if (stale.length + taken.length > 0) return { kind: "stale", ids: [...stale.map((e) => e.id), ...taken.map((p) => p.id!)] };
      const outside = rows.filter((d) => !expectIds.has(d.id));
      for (const p of input.put) {
        const other = findOverlap(p.members, outside);
        if (other) return { kind: "overlap", other };
      }
      if (outside.length + input.put.length > PLANNER_DESIGNATIONS_MAX_PER_SERVER) return { kind: "cap" };
      const planned = input.put.map((p, index) => {
        const current = p.id !== undefined && expectIds.has(p.id) ? rows.find((d) => d.id === p.id) : undefined;
        const parentId = current && p.parentId === undefined ? (current.parentId ?? null) : (p.parentId ?? null);
        return { p, current, parentId, id: p.id ?? `new:${index}` };
      });
      const breach = checkHierarchy([...outside.map(nodeOf), ...planned.map((w) => ({ id: w.id, parentId: w.parentId, memberCount: w.p.members.length }))]);
      if (breach) return breach;
      const putIds = new Set(input.put.map((p) => p.id));
      const removedIds = input.expect.filter((e) => !putIds.has(e.id)).map((e) => e.id);
      const written = planned.map(({ p, current, parentId }) => {
        const at = stamp();
        return current
          ? { ...current, name: p.name, members: p.members, parentId, updatedAt: at, revision: (current.revision ?? 1) + 1 }
          : { id: p.id ?? randomUUID(), name: p.name, mode: "core" as const, members: p.members, parentId, createdAt: p.createdAt ?? at, updatedAt: at, revision: 1 };
      });
      const kept = rows.filter((d) => !expectIds.has(d.id));
      rows.splice(0, rows.length, ...[...kept, ...written].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      return { kind: "replaced", designations: written, removedIds };
    },
  };
}

function build(options: { store?: ReturnType<typeof memoryStore>; buildings?: DesignationBuilding[] | null; noDb?: boolean } = {}) {
  const store = options.store ?? memoryStore();
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: {} }]);
  const routes = createDesignationRoutes(directory, options.noDb ? undefined : { store, buildings: async () => options.buildings ?? null });
  const signedIn: import("express").RequestHandler = (_req, res, next) => {
    res.locals.user = { id: "user-1" };
    next();
  };
  return { app: createApp({ logger: createLogger({ level: "silent" }), routers: [], sessionGuard: signedIn, protectedRouters: [routes] }), store };
}

const m = (id: string | null, c: string, x: number, y: number) => ({ id, c, x, y });
const body = (name: string, members = [m("b1", "S", 1, 1)]) => ({ name, mode: "core", members });
const path = endpoints.plannerDesignations.create.path("default");

describe("designation routes", () => {
  it("creates (201), lists oldest first with match info, updates, and deletes", async () => {
    const { app } = build({ buildings: [{ id: "b1", c: "S", x: 1, y: 1 }] });
    const first = await request(app).post(path).send(body("First"));
    expect(first.status).toBe(201);
    const second = await request(app).post(path).send(body("Second", [m("b2", "S", 9, 9)]));
    expect(second.status).toBe(201);

    const list = await request(app).get(path);
    expect(list.status).toBe(200);
    const parsed = PlannerDesignationsResponseSchema.parse(list.body);
    expect(parsed.designations.map((d) => d.name)).toEqual(["First", "Second"]);
    expect(parsed.matches).toEqual([
      { designationId: first.body.id, matched: 1, missing: 0, memberBuildingIds: ["b1"] },
      { designationId: second.body.id, matched: 0, missing: 1, memberBuildingIds: [null] },
    ]);

    const renamed = await request(app).put(endpoints.plannerDesignations.update.path("default", first.body.id)).send({ name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Renamed");

    const gone = await request(app).delete(endpoints.plannerDesignations.remove.path("default", first.body.id));
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ deleted: true });
    expect((await request(app).get(path)).body.designations).toHaveLength(1);
  });

  it("with no snapshot the list still answers 200, every member missing", async () => {
    const { app } = build({ buildings: null });
    await request(app).post(path).send(body("A"));
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.body.matches[0]).toMatchObject({ matched: 0, missing: 1 });
  });

  it("an empty list needs no buildings", async () => {
    const res = await request(build().app).get(path);
    expect(res.body).toEqual({ designations: [], matches: [] });
  });

  it("409 designation_overlap names the other designation, on create and on update", async () => {
    const { app } = build();
    const a = await request(app).post(path).send(body("Alpha", [m("b1", "S", 1, 1)]));
    const clash = await request(app).post(path).send(body("Beta", [m("b1", "S", 1, 1)]));
    expect(clash.status).toBe(409);
    expect(DesignationOverlapErrorSchema.parse(clash.body).error.other).toEqual({ id: a.body.id, name: "Alpha" });

    const b = await request(app).post(path).send(body("Beta", [m("b2", "S", 2, 2)]));
    const upd = await request(app).put(endpoints.plannerDesignations.update.path("default", b.body.id)).send({ members: [m("b1", "S", 1, 1)] });
    expect(upd.status).toBe(409);
    expect(upd.body.error.code).toBe("designation_overlap");
    // Re-saving a designation's own members is not an overlap with itself.
    const self = await request(app).put(endpoints.plannerDesignations.update.path("default", b.body.id)).send({ members: [m("b2", "S", 2, 2)] });
    expect(self.status).toBe(200);
  });

  it("409 designation_cap at the per-server limit", async () => {
    const store = memoryStore();
    const { app } = build({ store });
    for (let i = 0; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER; i++) {
      expect((await request(app).post(path).send(body(`D${i}`, [m(`b${i}`, "S", i, i)]))).status).toBe(201);
    }
    const res = await request(app).post(path).send(body("One too many", [m("zz", "S", 999, 999)]));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("designation_cap");
  });

  it("404 not_found for an unknown or malformed designation id, on update and delete", async () => {
    const { app } = build();
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const put = await request(app).put(endpoints.plannerDesignations.update.path("default", id)).send({ name: "x" });
      const del = await request(app).delete(endpoints.plannerDesignations.remove.path("default", id));
      expect([put.status, put.body.error.code]).toEqual([404, "not_found"]);
      expect([del.status, del.body.error.code]).toEqual([404, "not_found"]);
    }
  });

  it("400 for a bad body: invisible characters in the name, unknown keys, empty update", async () => {
    const { app } = build();
    const bad = [
      body("zero​width"),
      body("new\nline"),
      body("   "),
      { ...body("A"), extra: 1 },
      { ...body("A"), mode: "other" },
      body("A", [m("b1", "S", 0.5, 1)]),
      body("A", [m("dup", "S", 1, 1), m("dup", "S", 2, 2)]),
      { ...body("A"), parentId: "not-a-uuid" },
    ];
    for (const payload of bad) {
      const res = await request(app).post(path).send(payload);
      expect([res.status, res.body.error.code], JSON.stringify(payload).slice(0, 80)).toEqual([400, "bad_request"]);
    }
    const created = await request(app).post(path).send(body("A"));
    const empty = await request(app).put(endpoints.plannerDesignations.update.path("default", created.body.id)).send({});
    expect(empty.status).toBe(400);
  });

  it("accepts a 1000-member body of about 370 KB, past the app's 100 KB default, and refuses far larger", async () => {
    const { app } = build();
    const members = Array.from({ length: 1000 }, (_, i) => m(`Build_ConstructorMk1_C_21470${String(i).padStart(5, "0")}_abcdefghijklmnopqrstuvwxyz0123456789`, `Build_${"X".repeat(150)}_C`, i, -i));
    const ok = await request(app).post(path).send({ name: "Big", mode: "core", members });
    expect(JSON.stringify({ name: "Big", mode: "core", members }).length).toBeGreaterThan(200_000);
    expect(ok.status).toBe(201);
    const huge = await request(app).post(path).send({ name: "Huge", mode: "core", members, pad: "x".repeat(600_000) });
    expect(huge.status).toBe(413);
  });

  it("the larger limit covers PUT, a trailing slash and any path case, but not other routes", async () => {
    const { app } = build();
    const created = await request(app).post(path).send(body("Small"));
    const id = created.body.id as string;
    const members = Array.from({ length: 1000 }, (_, i) => m(`id-${i}-${"x".repeat(120)}`, `Build_${"X".repeat(150)}_C`, i, -i));
    expect(JSON.stringify({ members }).length).toBeGreaterThan(100_000);
    const put = await request(app).put(`${path}/${id}`).send({ members });
    expect(put.status).toBe(200);
    const slash = await request(app).put(`${path}/${id}/`).send({ name: "Renamed", members });
    expect(slash.status).toBe(200);
    const upper = await request(app).put(path.replace("designations", "DESIGNATIONS") + `/${id}`).send({ members });
    expect([200, 404]).toContain(upper.status);
    expect(upper.status).not.toBe(413);
    const other = await request(app).post("/api/servers/default/somewhere/else").send({ members });
    expect(other.status).not.toBe(201);
    const big = await request(app).put(`${path}/${id}`).send({ members, pad: "x".repeat(600_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("payload_too_large");
  });

  it("a name-only PUT keeps the designation's own members and is no overlap", async () => {
    const { app } = build();
    const created = await request(app).post(path).send(body("One", [m("b1", "S", 1, 1), m(null, "S", 5, 5)]));
    const res = await request(app).put(`${path}/${created.body.id}`).send({ name: "Two" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Two", members: [m("b1", "S", 1, 1), m(null, "S", 5, 5)] });
  });

  it("an unknown server is 404 and without a database every route is 503", async () => {
    const { app } = build();
    expect((await request(app).get(endpoints.plannerDesignations.list.path("nope"))).status).toBe(404);
    const noDb = build({ noDb: true }).app;
    expect((await request(noDb).get(path)).status).toBe(503);
    expect((await request(noDb).post(path).send(body("A"))).status).toBe(503);
  });
});

describe("designation replace route (ADR-0055 Decision 11)", () => {
  const replacePath = endpoints.plannerDesignations.replace.path("default");
  const create = async (app: ReturnType<typeof build>["app"], name: string, members: ReturnType<typeof m>[]) =>
    (await request(app).post(path).send(body(name, members))).body as PlannerDesignation;

  it("is POST .../planner/designations/replace", () => {
    expect(endpoints.plannerDesignations.replace).toMatchObject({ method: "POST", route: "/api/servers/:serverId/planner/designations/replace" });
    expect(replacePath).toBe("/api/servers/default/planner/designations/replace");
  });

  it("merges in place (kept id and createdAt, revision + 1), then a split back restores the originals", async () => {
    const { app } = build();
    const a = await create(app, "Alpha", [m("a1", "S", 1, 1)]);
    const b = await create(app, "Beta", [m("b1", "S", 2, 2), m(null, "S", 3, 3)]);
    const merged = await request(app)
      .post(replacePath)
      .send({ expect: [{ id: a.id, revision: 1 }, { id: b.id, revision: 1 }], put: [{ id: a.id, name: "Alpha", members: [...a.members, ...b.members] }], intent: "merge" });
    expect(merged.status).toBe(200);
    const parsed = ReplacePlannerDesignationsResponseSchema.parse(merged.body);
    expect(parsed.removedIds).toEqual([b.id]);
    expect(parsed.designations).toHaveLength(1);
    expect(parsed.designations[0]).toMatchObject({ id: a.id, createdAt: a.createdAt, revision: 2, members: [...a.members, ...b.members] });

    const undo = await request(app)
      .post(replacePath)
      .send({ expect: [{ id: a.id, revision: 2 }], put: [{ id: a.id, name: a.name, members: a.members }, { id: b.id, name: b.name, members: b.members, createdAt: b.createdAt }], intent: "undo" });
    expect(undo.status).toBe(200);
    expect(undo.body.removedIds).toEqual([]);
    const list = PlannerDesignationsResponseSchema.parse((await request(app).get(path)).body);
    expect(list.designations.map((d) => ({ id: d.id, members: d.members, createdAt: d.createdAt }))).toEqual(
      [a, b].map((d) => ({ id: d.id, members: d.members, createdAt: d.createdAt })),
    );
  });

  it("dissolves with an empty put", async () => {
    const { app } = build();
    const a = await create(app, "Alpha", [m("a1", "S", 1, 1)]);
    const res = await request(app).post(replacePath).send({ expect: [{ id: a.id, revision: 1 }], put: [], intent: "dissolve" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ designations: [], removedIds: [a.id] });
  });

  it("409 designation_stale for a moved revision, an unknown expected id, or an inserted id that still exists", async () => {
    const { app } = build();
    const a = await create(app, "Alpha", [m("a1", "S", 1, 1)]);
    const b = await create(app, "Beta", [m("b1", "S", 2, 2)]);
    await request(app).put(endpoints.plannerDesignations.update.path("default", a.id)).send({ name: "Renamed" });
    const cases = [
      { expect: [{ id: a.id, revision: 1 }], put: [] },
      { expect: [{ id: randomUUID(), revision: 1 }], put: [] },
      { expect: [], put: [{ id: b.id, name: "Copy", members: [m("c1", "S", 9, 9)] }] },
    ];
    for (const payload of cases) {
      const res = await request(app).post(replacePath).send(payload);
      expect([res.status, res.body.error.code]).toEqual([409, "designation_stale"]);
    }
    expect((await request(app).get(path)).body.designations).toHaveLength(2);
  });

  it("409 designation_overlap names a designation outside expect; one inside expect is no overlap", async () => {
    const { app } = build();
    const a = await create(app, "Alpha", [m("a1", "S", 1, 1)]);
    const b = await create(app, "Beta", [m("b1", "S", 2, 2)]);
    const clash = await request(app).post(replacePath).send({ expect: [{ id: a.id, revision: 1 }], put: [{ id: a.id, name: "Alpha", members: [m("b1", "S", 2, 2)] }] });
    expect(clash.status).toBe(409);
    expect(DesignationOverlapErrorSchema.parse(clash.body).error.other).toEqual({ id: b.id, name: "Beta" });
    const fine = await request(app).post(replacePath).send({ expect: [{ id: a.id, revision: 1 }, { id: b.id, revision: 1 }], put: [{ name: "Both", members: [m("a1", "S", 1, 1), m("b1", "S", 2, 2)] }] });
    expect(fine.status).toBe(200);
  });

  it("409 designation_cap when the resulting set would pass the limit (a split at the cap)", async () => {
    const { app } = build();
    const all: PlannerDesignation[] = [];
    for (let i = 0; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER; i++) all.push(await create(app, `D${i}`, [m(`b${i}`, "S", i, i), m(`c${i}`, "S", i, i + 500)]));
    const d0 = all[0]!;
    const split = await request(app)
      .post(replacePath)
      .send({ expect: [{ id: d0.id, revision: 1 }], put: [{ id: d0.id, name: "D0", members: [d0.members[0]] }, { name: "New", members: [d0.members[1]] }] });
    expect([split.status, split.body.error.code]).toEqual([409, "designation_cap"]);
    // Merging two at the cap lowers the count: fine.
    const d1 = all[1]!;
    const merge = await request(app).post(replacePath).send({ expect: [{ id: d0.id, revision: 1 }, { id: d1.id, revision: 1 }], put: [{ id: d0.id, name: "D0", members: [...d0.members, ...d1.members] }] });
    expect(merge.status).toBe(200);
  });

  it("400 bad_request for a bad body, a createdAt in the future, or put entries sharing a building", async () => {
    const { app } = build();
    const a = await create(app, "Alpha", [m("a1", "S", 1, 1)]);
    const future = new Date(Date.now() + 60_000).toISOString();
    const bad = [
      { expect: [], put: [] },
      { expect: [], put: [{ name: "X", members: [m("x1", "S", 5, 5)] }], intent: "Merge" },
      { expect: [], put: [{ name: "X", members: [m("x1", "S", 5, 5)] }], extra: 1 },
      { expect: [{ id: "not-a-uuid", revision: 1 }], put: [] },
      { expect: [{ id: a.id, revision: 0 }], put: [] },
      { expect: [{ id: a.id, revision: 1 }, { id: a.id, revision: 1 }], put: [] },
      { expect: [], put: [{ name: "X", members: [m("x1", "S", 5, 5)] }, { name: "Y", members: [m("x1", "S", 5, 5)] }] },
      { expect: [], put: [{ id: randomUUID(), name: "X", members: [m("x1", "S", 5, 5)], createdAt: future }] },
      { expect: [], put: [{ name: "X", members: [m("x1", "S", 5, 5)], parentId: "not-a-uuid" }] },
    ];
    for (const payload of bad) {
      const res = await request(app).post(replacePath).send(payload);
      expect([res.status, res.body.error.code], JSON.stringify(payload).slice(0, 120)).toEqual([400, "bad_request"]);
    }
    expect((await request(app).get(path)).body.designations).toHaveLength(1);
  });

  it("takes 2000 members (past the 512 KB designation limit) and refuses a body over 1 MB with 413", async () => {
    const { app } = build();
    const many = (prefix: string) => Array.from({ length: 1000 }, (_, i) => m(`${prefix}-${i}-${"x".repeat(120)}`, `Build_${"X".repeat(150)}_C`, i, prefix === "p" ? i : -i - 1));
    const payload = { expect: [], put: [{ name: "P", members: many("p") }, { name: "Q", members: many("q") }] };
    expect(JSON.stringify(payload).length).toBeGreaterThan(600_000);
    const ok = await request(app).post(replacePath).send(payload);
    expect(ok.status).toBe(200);
    const big = await request(app).post(replacePath).send({ ...payload, pad: "x".repeat(1_100_000) });
    expect([big.status, big.body.error.code]).toEqual([413, "payload_too_large"]);
  });

  it("without a database it is 503, and an unknown server 404", async () => {
    const payload = { expect: [{ id: randomUUID(), revision: 1 }], put: [] };
    expect((await request(build({ noDb: true }).app).post(replacePath).send(payload)).status).toBe(503);
    expect((await request(build().app).post(endpoints.plannerDesignations.replace.path("nope")).send(payload)).status).toBe(404);
  });
});

describe("designation nesting (ADR-0061)", () => {
  const replacePath = endpoints.plannerDesignations.replace.path("default");
  type App = ReturnType<typeof build>["app"];
  let n = 0;
  /** A designation with one fresh building (or none), optionally inside `parentId`. */
  const make = async (app: App, name: string, parentId?: string | null, members = [m(`b${++n}`, "S", n, n)]) => {
    const res = await request(app).post(path).send({ ...body(name, members), ...(parentId !== undefined && { parentId }) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as PlannerDesignation & { revision: number };
  };
  const list = async (app: App) => PlannerDesignationsResponseSchema.parse((await request(app).get(path)).body).designations;
  const parents = async (app: App) => new Map((await list(app)).map((d) => [d.name, d.parentId ?? null] as const));
  const replace = (app: App, payload: object) => request(app).post(replacePath).send(payload);
  const code = (res: { status: number; body: { error?: { code: string } } }) => [res.status, res.body.error?.code];
  const put = (d: PlannerDesignation & { revision?: number }, extra: object = {}) => ({ id: d.id, name: d.name, members: d.members, ...extra });
  const expectOf = (...ds: (PlannerDesignation & { revision?: number })[]) => ds.map((d) => ({ id: d.id, revision: d.revision ?? 1 }));

  it("serves what build PR 1 refused: parentId null or a real parent, and an empty put entry with a child", async () => {
    const { app } = build();
    const top = await make(app, "Top", null);
    expect(top.parentId).toBeNull();
    const child = await make(app, "Child", top.id);
    expect(child.parentId).toBe(top.id);
    // An in-place put with parentId null moves it to the top level.
    const moved = await replace(app, { expect: expectOf(child), put: [put(child, { parentId: null })], intent: "move" });
    expect(moved.status).toBe(200);
    expect(ReplacePlannerDesignationsResponseSchema.parse(moved.body).designations[0]).toMatchObject({ id: child.id, parentId: null, revision: 2 });
    // An insert naming an existing parent.
    const ins = await replace(app, { expect: [], put: [{ name: "Inserted", members: [m("i1", "S", 50, 50)], parentId: top.id }] });
    expect([ins.status, ins.body.designations[0].parentId]).toEqual([200, top.id]);
  });

  it("409 designation_shape: no members and no children, on create and on a put", async () => {
    const { app } = build();
    expect(code(await request(app).post(path).send({ ...body("Empty"), members: [] }))).toEqual([409, "designation_shape"]);
    expect(code(await replace(app, { expect: [], put: [{ name: "Empty", members: [] }] }))).toEqual([409, "designation_shape"]);
    // Moving the only child out of an empty parent leaves it empty: refused, nothing changes.
    const group = await replace(app, { expect: [], put: [{ id: randomUUID(), name: "Area", members: [] }] });
    expect(code(group)).toEqual([409, "designation_shape"]);
    const area = randomUUID();
    const a = await make(app, "A");
    const grouped = await replace(app, { expect: expectOf(a), put: [{ id: area, name: "Area", members: [] }, put(a, { parentId: area })], intent: "group" });
    expect(grouped.status).toBe(200);
    const aNow = grouped.body.designations[1];
    expect(code(await replace(app, { expect: expectOf(aNow), put: [put(aNow, { parentId: null })], intent: "move" }))).toEqual([409, "designation_shape"]);
    expect(await parents(app)).toEqual(new Map([["Area", null], ["A", area]]));
  });

  it("409 designation_cycle: a self-parent, and a parent moved under its own child", async () => {
    const { app } = build();
    const p = await make(app, "P");
    const c = await make(app, "C", p.id);
    expect(code(await replace(app, { expect: expectOf(p), put: [put(p, { parentId: p.id })], intent: "move" }))).toEqual([409, "designation_cycle"]);
    expect(code(await replace(app, { expect: expectOf(p), put: [put(p, { parentId: c.id })], intent: "move" }))).toEqual([409, "designation_cycle"]);
    // An insert naming itself as the parent: there is nothing above it, so it is a cycle too.
    const self = randomUUID();
    expect(code(await replace(app, { expect: [], put: [{ id: self, name: "Self", members: [m("s1", "S", 70, 70)], parentId: self }] }))).toEqual([409, "designation_cycle"]);
    expect(await parents(app)).toEqual(new Map([["P", null], ["C", p.id]]));
  });

  it("409 designation_depth: a fourth level on create, and a move that pushes a subtree past 3", async () => {
    const { app } = build();
    const a = await make(app, "A");
    const b = await make(app, "B", a.id);
    const c = await make(app, "C", b.id);
    expect(code(await request(app).post(path).send({ ...body("D", [m("d1", "S", 90, 90)]), parentId: c.id }))).toEqual([409, "designation_depth"]);
    const other = await make(app, "Other");
    // Moving A (3 levels tall) under Other would put C at level 4.
    expect(code(await replace(app, { expect: expectOf(a), put: [put(a, { parentId: other.id })], intent: "move" }))).toEqual([409, "designation_depth"]);
    // Moving B (2 levels tall) under Other is fine: B at 2, C at 3.
    const fine = await replace(app, { expect: expectOf(b), put: [put(b, { parentId: other.id })], intent: "move" });
    expect(fine.status).toBe(200);
    expect(await parents(app)).toEqual(new Map([["A", null], ["B", other.id], ["C", b.id], ["Other", null]]));
  });

  it("409 designation_stale: a missing parent on create, a parent this replace removes, and a child left behind", async () => {
    const { app } = build();
    expect(code(await request(app).post(path).send({ ...body("X"), parentId: randomUUID() }))).toEqual([409, "designation_stale"]);
    const p = await make(app, "P");
    const kid = await make(app, "Kid", p.id);
    // The same replace removes P and names it as a parent.
    expect(code(await replace(app, { expect: expectOf(p), put: [{ name: "New", members: [m("n1", "S", 80, 80)], parentId: p.id }] }))).toEqual([409, "designation_stale"]);
    // Dissolving P without saying where Kid goes (a client that did not know about Kid): Kid would name a parent that is gone.
    expect(code(await replace(app, { expect: expectOf(p), put: [], intent: "dissolve" }))).toEqual([409, "designation_stale"]);
    expect(await parents(app)).toEqual(new Map([["P", null], ["Kid", p.id]]));
    expect(kid.parentId).toBe(p.id);
  });

  it("a concurrent delete of the parent: the next write naming it is a clean 409 designation_stale, nothing dangles", async () => {
    const { app } = build();
    const p = await make(app, "P");
    const sibling = await make(app, "Sibling");
    // Another client deletes P between this client's read and its writes.
    expect((await request(app).delete(endpoints.plannerDesignations.remove.path("default", p.id))).status).toBe(200);
    expect(code(await request(app).post(path).send({ ...body("Late", [m("l1", "S", 60, 60)]), parentId: p.id }))).toEqual([409, "designation_stale"]);
    expect(code(await replace(app, { expect: expectOf(sibling), put: [put(sibling, { parentId: p.id })], intent: "move" }))).toEqual([409, "designation_stale"]);
    expect(await parents(app)).toEqual(new Map([["Sibling", null]]));
  });

  it("a put in place: absent parentId keeps the parent, null moves to the top level", async () => {
    const { app } = build();
    const p = await make(app, "P");
    const c = await make(app, "C", p.id);
    const kept = await replace(app, { expect: expectOf(c), put: [{ id: c.id, name: "C renamed", members: c.members }], intent: "merge" });
    expect([kept.status, kept.body.designations[0].parentId]).toEqual([200, p.id]);
    const top = await replace(app, { expect: [{ id: c.id, revision: 2 }], put: [{ id: c.id, name: "C", members: c.members, parentId: null }], intent: "move" });
    expect([top.status, top.body.designations[0].parentId]).toEqual([200, null]);
    // On an insert, absent is the top level.
    const ins = await replace(app, { expect: [], put: [{ name: "Fresh", members: [m("f1", "S", 40, 40)] }] });
    expect(ins.body.designations[0].parentId).toBeNull();
  });

  it("group (with a parent that owns no machines), then ungroup moves the children up a level", async () => {
    const { app } = build();
    const outer = await make(app, "Outer");
    const a = await make(app, "A", outer.id);
    const b = await make(app, "B", outer.id);
    const area = randomUUID();
    // The new parent comes AFTER the children that name it in `put`: the order does not matter.
    const grouped = await replace(app, {
      expect: expectOf(a, b),
      put: [put(a, { parentId: area }), put(b, { parentId: area }), { id: area, name: "Area", members: [], parentId: outer.id }],
      intent: "group",
    });
    expect(grouped.status, JSON.stringify(grouped.body)).toBe(200);
    expect(grouped.body.designations.map((d: PlannerDesignation) => d.parentId)).toEqual([area, area, outer.id]);
    expect(await parents(app)).toEqual(new Map([["Outer", null], ["A", area], ["B", area], ["Area", outer.id]]));

    const [aNow, bNow] = grouped.body.designations as (PlannerDesignation & { revision: number })[];
    const areaRow = (await list(app)).find((d) => d.id === area)!;
    const ungrouped = await replace(app, {
      expect: expectOf(areaRow, aNow!, bNow!),
      put: [put(aNow!, { parentId: outer.id }), put(bNow!, { parentId: outer.id })],
      intent: "ungroup",
    });
    expect([ungrouped.status, ungrouped.body.removedIds]).toEqual([200, [area]]);
    expect(await parents(app)).toEqual(new Map([["Outer", null], ["A", outer.id], ["B", outer.id]]));
  });

  it("DELETE of a parent moves its children to its own parent (a write to each: revision + 1)", async () => {
    const { app } = build();
    const g = await make(app, "G");
    const p = await make(app, "P", g.id);
    const c1 = await make(app, "C1", p.id);
    await make(app, "C2", p.id);
    expect((await request(app).delete(endpoints.plannerDesignations.remove.path("default", p.id))).body).toEqual({ deleted: true });
    expect(await parents(app)).toEqual(new Map([["G", null], ["C1", g.id], ["C2", g.id]]));
    expect((await list(app)).find((d) => d.id === c1.id)?.revision).toBe(2);
    // Deleting the top-level G moves them to the top level.
    await request(app).delete(endpoints.plannerDesignations.remove.path("default", g.id));
    expect(await parents(app)).toEqual(new Map([["C1", null], ["C2", null]]));
  });

  it("DELETE of the last child of a parent that owns no machines deletes the parent too, up the tree", async () => {
    const { app } = build();
    const keep = await make(app, "Keep");
    const outer = randomUUID();
    const inner = randomUUID();
    const res = await replace(app, {
      expect: expectOf(keep),
      put: [{ id: outer, name: "Outer", members: [] }, { id: inner, name: "Inner", members: [], parentId: outer }, put(keep, { parentId: inner })],
      intent: "group",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const other = await make(app, "Owns", inner);
    await request(app).delete(endpoints.plannerDesignations.remove.path("default", other.id));
    // Inner still has Keep: nothing else goes.
    expect([...(await parents(app)).keys()]).toEqual(["Keep", "Outer", "Inner"]);
    await request(app).delete(endpoints.plannerDesignations.remove.path("default", keep.id));
    expect(await list(app)).toEqual([]);
  });

  it("a parent that owns machines stays when its last child is deleted; the cap counts parents", async () => {
    const { app } = build();
    const p = await make(app, "P");
    const c = await make(app, "C", p.id);
    await request(app).delete(endpoints.plannerDesignations.remove.path("default", c.id));
    expect(await parents(app)).toEqual(new Map([["P", null]]));
    for (let i = 1; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER; i++) await make(app, `K${i}`, p.id);
    expect(code(await request(app).post(path).send(body("Over", [m("ov", "S", -5, -5)])))).toEqual([409, "designation_cap"]);
  });
});

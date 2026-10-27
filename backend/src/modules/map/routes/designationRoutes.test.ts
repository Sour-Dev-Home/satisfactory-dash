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
import { findOverlap } from "../services/designationMatching.js";
import type { DesignationBuilding } from "../services/designationMatching.js";

/** A store in memory with the database store's rules (cap, overlap), so the routes are tested against real outcomes. */
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
      const at = stamp();
      const designation: PlannerDesignation = { id: randomUUID(), name: input.name, mode: input.mode, members: input.members, createdAt: at, updatedAt: at, revision: 1 };
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
      const at = rows.findIndex((d) => d.id === id);
      if (at < 0) return false;
      rows.splice(at, 1);
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
      const putIds = new Set(input.put.map((p) => p.id));
      const removedIds = input.expect.filter((e) => !putIds.has(e.id)).map((e) => e.id);
      const written = input.put.map((p) => {
        const current = p.id !== undefined && expectIds.has(p.id) ? rows.find((d) => d.id === p.id) : undefined;
        const at = stamp();
        return current
          ? { ...current, name: p.name, members: p.members, updatedAt: at, revision: (current.revision ?? 1) + 1 }
          : { id: p.id ?? randomUUID(), name: p.name, mode: "core" as const, members: p.members, createdAt: p.createdAt ?? at, updatedAt: at, revision: 1 };
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

  it("400 for a bad body: empty members, invisible characters in the name, unknown keys, empty update", async () => {
    const { app } = build();
    const bad = [
      { ...body("A"), members: [] },
      body("zero​width"),
      body("new\nline"),
      body("   "),
      { ...body("A"), extra: 1 },
      { ...body("A"), mode: "other" },
      body("A", [m("b1", "S", 0.5, 1)]),
      body("A", [m("dup", "S", 1, 1), m("dup", "S", 2, 2)]),
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

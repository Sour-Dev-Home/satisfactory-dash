import { describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { DesignationOverlapErrorSchema, PLANNER_DESIGNATIONS_MAX_PER_SERVER, PlannerDesignationsResponseSchema, endpoints } from "@satisfactory-dash/shared";
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
      const designation: PlannerDesignation = { id: randomUUID(), name: input.name, mode: input.mode, members: input.members, createdAt: at, updatedAt: at };
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
      Object.assign(current, { name: input.name ?? current.name, members: input.members ?? current.members, updatedAt: stamp() });
      return { kind: "updated", designation: current };
    },
    remove: async (_server, id) => {
      const at = rows.findIndex((d) => d.id === id);
      if (at < 0) return false;
      rows.splice(at, 1);
      return true;
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
      { designationId: first.body.id, matched: 1, missing: 0 },
      { designationId: second.body.id, matched: 0, missing: 1 },
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

  it("an unknown server is 404 and without a database every route is 503", async () => {
    const { app } = build();
    expect((await request(app).get(endpoints.plannerDesignations.list.path("nope"))).status).toBe(404);
    const noDb = build({ noDb: true }).app;
    expect((await request(noDb).get(path)).status).toBe(503);
    expect((await request(noDb).post(path).send(body("A"))).status).toBe(503);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSanity, parseSanityOutput, restoreCheck } from "./restore-check.mjs";

const GOOD = "migration|1791158400000_map_world_layers\nusers|2\nservers|1\naudit_events|10\n";

test("parseSanityOutput reads key|value lines", () => {
  assert.deepEqual(parseSanityOutput(GOOD), {
    latestMigration: "1791158400000_map_world_layers",
    counts: { users: 2, servers: 1, audit_events: 10 },
  });
});

test("parseSanityOutput: a missing table (empty value) becomes null, noise lines are ignored", () => {
  const r = parseSanityOutput("migration|\nusers|\nWARNING: something\nservers|3\n");
  assert.equal(r.latestMigration, "");
  assert.deepEqual(r.counts, { users: null, servers: 3 });
});

test("evaluateSanity passes with a schema version and rows", () => {
  assert.deepEqual(evaluateSanity(parseSanityOutput(GOOD)), { ok: true, problems: [] });
});

test("evaluateSanity fails without a schema version", () => {
  const r = evaluateSanity({ latestMigration: "", counts: { users: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /schema version/);
});

test("evaluateSanity fails when a table is missing or unreadable", () => {
  const r = evaluateSanity({ latestMigration: "1_x", counts: { users: 1, servers: null } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /servers/);
});

test("evaluateSanity fails when users are under the minimum, and the minimum can be lowered", () => {
  const sanity = { latestMigration: "1_x", counts: { users: 0, servers: 0 } };
  assert.equal(evaluateSanity(sanity).ok, false);
  assert.equal(evaluateSanity(sanity, { minUsers: 0 }).ok, true);
});

/** Fakes that record what happened, so the tests can assert on the cleanup. */
function fakes(overrides = {}) {
  const events = [];
  const deps = {
    log: () => {},
    makeWorkDir: async () => (events.push("mkdir"), "/work"),
    listNewest: async () => (events.push("list"), { key: "satis-dash/satis-1.dump.age", size: 50_000 }),
    download: async () => (events.push("download"), "/work/satis.dump.age"),
    decrypt: async () => (events.push("decrypt"), "/work/satis.dump"),
    startDb: async () => (events.push("startDb"), { id: "db1" }),
    createRoles: async () => events.push("roles"),
    restore: async () => events.push("restore"),
    sanity: async () => (events.push("sanity"), GOOD),
    stopDb: async () => events.push("stopDb"),
    removeDir: async (dir) => events.push(`rm ${dir}`),
    ...overrides,
  };
  return { deps, events };
}

test("a good run restores in order (roles first) and deletes the plaintext folder and the database", async () => {
  const { deps, events } = fakes();
  const r = await restoreCheck(deps);
  assert.equal(r.ok, true);
  assert.deepEqual(events, ["mkdir", "list", "download", "decrypt", "startDb", "roles", "restore", "sanity", "stopDb", "rm /work"]);
});

for (const step of ["listNewest", "download", "decrypt", "startDb", "createRoles", "restore", "sanity"]) {
  test(`a failure in ${step} fails the check and still deletes the plaintext and the database`, async () => {
    const { deps, events } = fakes({
      [step]: async () => {
        throw new Error(`${step} exploded`);
      },
    });
    const r = await restoreCheck(deps);
    assert.equal(r.ok, false);
    assert.match(r.problems.join("\n"), new RegExp(`${step} exploded`));
    assert.ok(events.includes("rm /work"), "the work folder (with any plaintext) is removed");
    if (step !== "listNewest" && step !== "download" && step !== "decrypt" && step !== "startDb") assert.ok(events.includes("stopDb"));
    assert.equal(events.at(-1), "rm /work", "removal is last");
  });
}

test("a sanity failure fails the check and cleans up", async () => {
  const { deps, events } = fakes({ sanity: async () => "migration|\nusers|0\n" });
  const r = await restoreCheck(deps);
  assert.equal(r.ok, false);
  assert.ok(events.includes("stopDb") && events.includes("rm /work"));
});

test("no backup in the bucket fails", async () => {
  const { deps, events } = fakes({ listNewest: async () => null });
  const r = await restoreCheck(deps);
  assert.equal(r.ok, false);
  assert.ok(events.includes("rm /work"));
});

test("if deleting the plaintext fails, the check fails loudly and names the folder", async () => {
  const { deps } = fakes({
    removeDir: async () => {
      throw new Error("EBUSY");
    },
  });
  const r = await restoreCheck(deps);
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /delete .*\/work/i);
});

test("if stopping the database fails, the plaintext is still deleted", async () => {
  const { deps, events } = fakes({
    stopDb: async () => {
      throw new Error("docker gone");
    },
  });
  const r = await restoreCheck(deps);
  assert.equal(r.ok, false);
  assert.ok(events.includes("rm /work"));
});

test("problem text never contains secret-looking material passed through errors", async () => {
  const { deps } = fakes({
    decrypt: async () => {
      throw new Error("age failed with AGE-SECRET-KEY-1ABCDEFGHJKLMNPQRSTUVWXYZ0123456789ACDEFGHJKLMNPQRSTUVWXYZ0");
    },
  });
  const r = await restoreCheck(deps);
  assert.doesNotMatch(r.problems.join("\n"), /AGE-SECRET-KEY-1\w+/);
});

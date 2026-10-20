import { test } from "node:test";
import assert from "node:assert/strict";
import { AGE_MAGIC, checkBackups, pickDumps, runCheck } from "./backup-check.mjs";

const NOW = new Date("2026-10-20T12:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const obj = (name, hours, size) => ({ Key: `satis-dash/${name}`, Size: size, LastModified: hoursAgo(hours) });
const goodHeader = Buffer.from(`${AGE_MAGIC}-> X25519 abc\n`);

test("pickDumps keeps only satis-*.dump.age and sorts newest first", () => {
  const dumps = pickDumps({
    Contents: [
      obj("satis-2026-10-18.dump.age", 40, 50_000),
      obj("notes.txt", 1, 10),
      obj("satis-2026-10-20.dump.age", 3, 52_000),
      { Key: "satis-dash/satis-2026-10-19.dump", Size: 9, LastModified: hoursAgo(2) },
    ],
  });
  assert.deepEqual(dumps.map((d) => d.key), ["satis-dash/satis-2026-10-20.dump.age", "satis-dash/satis-2026-10-18.dump.age"]);
});

test("pickDumps copes with an empty bucket (no Contents)", () => {
  assert.deepEqual(pickDumps({}), []);
  assert.deepEqual(pickDumps(null), []);
});

const dumpsOf = (...specs) => pickDumps({ Contents: specs.map(([h, size]) => obj(`satis-${h}.dump.age`, h, size)) });

test("a fresh, sized, age-headed dump passes", () => {
  const r = checkBackups({ dumps: dumpsOf([3, 50_000], [27, 49_000]), headerBytes: goodHeader, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});

test("no dumps at all fails", () => {
  const r = checkBackups({ dumps: [], headerBytes: null, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /no backup/i);
});

test("freshness: 26 h is the edge, older fails", () => {
  assert.equal(checkBackups({ dumps: dumpsOf([25.9, 50_000]), headerBytes: goodHeader, now: NOW }).ok, true);
  const r = checkBackups({ dumps: dumpsOf([26.5, 50_000]), headerBytes: goodHeader, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /older than 26 h/);
});

test("a dump dated in the future fails (clock or key problem)", () => {
  const r = checkBackups({ dumps: dumpsOf([-3, 50_000]), headerBytes: goodHeader, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /future/);
});

test("size floor: below the minimum fails, at it passes", () => {
  assert.equal(checkBackups({ dumps: dumpsOf([3, 2047]), headerBytes: goodHeader, now: NOW }).ok, false);
  assert.equal(checkBackups({ dumps: dumpsOf([3, 2048]), headerBytes: goodHeader, now: NOW }).ok, true);
});

test("size versus the previous dump: under half or over double fails", () => {
  const shrink = checkBackups({ dumps: dumpsOf([3, 20_000], [27, 50_000]), headerBytes: goodHeader, now: NOW });
  assert.equal(shrink.ok, false);
  assert.match(shrink.problems.join("\n"), /previous/);
  const grow = checkBackups({ dumps: dumpsOf([3, 120_000], [27, 50_000]), headerBytes: goodHeader, now: NOW });
  assert.equal(grow.ok, false);
  assert.equal(checkBackups({ dumps: dumpsOf([3, 60_000], [27, 50_000]), headerBytes: goodHeader, now: NOW }).ok, true);
});

test("the header must start with the age magic", () => {
  for (const bad of [Buffer.from("PGDMP\u0001\u000e\u0000"), Buffer.alloc(0), null, Buffer.from("age-encryption.org/v2\n")]) {
    const r = checkBackups({ dumps: dumpsOf([3, 50_000]), headerBytes: bad, now: NOW });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.problems.join("\n"), /age header/);
  }
});

test("all problems are reported together", () => {
  const r = checkBackups({ dumps: dumpsOf([40, 10]), headerBytes: Buffer.from("x"), now: NOW });
  assert.equal(r.problems.length, 3);
});

test("thresholds can be overridden", () => {
  const r = checkBackups({ dumps: dumpsOf([40, 50_000]), headerBytes: goodHeader, now: NOW, maxAgeHours: 48 });
  assert.equal(r.ok, true);
});

test("runCheck lists, then reads only the newest object's first bytes, never decrypting", async () => {
  const calls = [];
  const aws = async (args) => {
    calls.push(args);
    if (args[0] === "list") return { Contents: [obj("satis-a.dump.age", 3, 50_000), obj("satis-b.dump.age", 27, 49_000)] };
    return goodHeader;
  };
  const r = await runCheck({ aws, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[1], ["head", "satis-dash/satis-a.dump.age"]);
  assert.equal(calls.length, 2);
});

test("runCheck skips the header read when there is nothing to read, and surfaces a listing error as a failure", async () => {
  const empty = await runCheck({ aws: async () => ({}), now: NOW });
  assert.equal(empty.ok, false);
  const broken = await runCheck({
    aws: async () => {
      throw new Error("AccessDenied");
    },
    now: NOW,
  });
  assert.equal(broken.ok, false);
  assert.match(broken.problems[0], /AccessDenied/);
});

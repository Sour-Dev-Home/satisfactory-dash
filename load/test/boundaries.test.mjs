// Boundary cases for the load kit: each pins a limit that an off-by-one would move without any other test noticing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertLoadDatabaseUrl, assertLocalTarget } from "../lib/guards.mjs";
import { createHttp } from "../lib/seed.mjs";
import { findKnee, readK6Points } from "../../scripts/load-report.mjs";

test("a port is 1 to 65535: 65535 is accepted, 65536 and 0 are refused", () => {
  assert.equal(assertLocalTarget("http://localhost:65535"), "http://localhost:65535");
  assert.throws(() => assertLocalTarget("http://localhost:65536"), /Refused/);
  assert.throws(() => assertLocalTarget("http://localhost:0"), /Refused/);
});

test("a snapshot p95 of exactly 1 s is not past the limit; 1 ms over is", () => {
  const base = { start: 0, count: 100, p50: 1, p95: 1, p99: 1, errorRate: 0, agents: 5 };
  assert.equal(findKnee([{ ...base, minute: 0, snapshotP95: 1000 }]), null);
  const knee = findKnee([
    { ...base, minute: 0, snapshotP95: 1000 },
    { ...base, minute: 1, snapshotP95: 1000.1, agents: 10 },
  ]);
  assert.deepEqual([knee.minute, knee.agents, knee.reason, knee.lastGoodAgents], [1, 10, "snapshot p95 above 1 s", 5]);
});

test("a 429 is retried exactly maxRetries times, then the next 429 is the failure", async () => {
  let calls = 0;
  const http = createHttp({
    fetch: async () => {
      calls++;
      return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
    },
    base: "http://127.0.0.1:3001",
    sleep: async () => {},
    maxRetries: 3,
  });
  await assert.rejects(http.json({ method: "GET", path: "/x" }), /429/);
  assert.equal(calls, 4);
});

test("a k6 point at the window's start counts and one at its end does not", () => {
  const line = (time) => JSON.stringify({ type: "Point", metric: "http_req_duration", data: { time, value: 5, tags: { name: "GET /a", status: "200" } } });
  const since = Date.parse("2026-10-20T10:00:00Z");
  const until = Date.parse("2026-10-20T10:01:00Z");
  const { points } = readK6Points([line("2026-10-20T10:00:00Z"), line("2026-10-20T10:01:00Z"), line("2026-10-20T09:59:59.999Z")], since, until);
  assert.equal(points.length, 1);
});

test("k6's nanosecond timestamps with an offset are read", () => {
  const line = JSON.stringify({ type: "Point", metric: "http_req_failed", data: { time: "2026-10-20T12:00:30.123456789+02:00", value: 1, tags: { name: "GET /a" } } });
  const { points } = readK6Points([line], Date.parse("2026-10-20T10:00:00Z"), Date.parse("2026-10-20T10:01:00Z"));
  assert.equal(points.length, 1);
});

test("the database host: 127.0.0.1, localhost (any case), postgres and userinfo pass; IPv6, trailing dot, host-less, @-tricks and host= are refused", () => {
  const env = { LOAD_TEST: "1" };
  for (const ok of [
    "postgres://u:p@127.0.0.1:5432/satis_load",
    "postgres://u:p@LOCALHOST/satis_load",
    "postgres://u@postgres:5432/satis_load?sslmode=disable",
    "postgres://u:p%40x@127.0.0.1/satis_load",
  ]) {
    assert.equal(assertLoadDatabaseUrl(ok, env), "satis_load");
  }
  for (const bad of [
    "postgres://u@[::1]:5432/satis_load",
    "postgres:///satis_load",
    "postgres://u:p@/satis_load",
    "postgres://localhost./satis_load",
    "postgres://127.0.0.1@evil.example/satis_load",
    "postgres://127.0.0.1,evil.example/satis_load",
    "postgres://u@127.0.0.1:5432/satis_load?host=evil.example",
  ]) {
    assert.throws(() => assertLoadDatabaseUrl(bad, env), /Refused/, bad);
  }
});

test("load-report exits 2 for a usage or guard error and 1 for a missing input file, one line each", () => {
  const script = fileURLToPath(new URL("../../scripts/load-report.mjs", import.meta.url));
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  assert.equal(run([]).status, 2);
  const window = ["--since", "2026-10-20T10:00:00Z", "--until", "2026-10-20T10:01:00Z"];
  const guard = run(["--scenario", "a", "--summary", "x.json", ...window], { DATABASE_URL: "postgres://u@db.example/satis_load", LOAD_TEST: "1" });
  assert.equal(guard.status, 2);
  assert.match(guard.stderr, /Refused/);
  const missing = run(["--scenario", "a", "--summary", "nope.json", "--rows", "nope-rows.json", ...window]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim().split("\n").length, 1);
});

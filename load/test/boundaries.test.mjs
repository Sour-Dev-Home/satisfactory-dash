// Boundary cases for the load kit: each pins a limit that an off-by-one would move without any other test noticing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalTarget } from "../lib/guards.mjs";
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

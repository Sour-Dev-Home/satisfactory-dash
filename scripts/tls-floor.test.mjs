import { test } from "node:test";
import assert from "node:assert/strict";
import { planZoneChange, probeOutcome, verdict } from "./tls-floor.mjs";

const all = (old, v12 = "accepted") => ({ TLSv1: old, "TLSv1.1": old, "TLSv1.2": v12 });

test("a handshake that completes is accepted", () => {
  assert.equal(probeOutcome({ ok: true }), "accepted");
});

test("the server's protocol_version alert is a refusal", () => {
  assert.equal(probeOutcome({ ok: false, code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" }), "refused");
  assert.equal(probeOutcome({ ok: false, message: "ssl3_read_bytes:tlsv1 alert protocol version" }), "refused");
});

test("a client that can't offer the version is inconclusive, never a refusal", () => {
  assert.equal(probeOutcome({ ok: false, code: "ERR_SSL_NO_PROTOCOLS_AVAILABLE" }), "client-cannot-offer");
  assert.equal(probeOutcome({ ok: false, message: "tls_setup_handshake:no protocols available" }), "client-cannot-offer");
});

test("any other failure is an error", () => {
  assert.equal(probeOutcome({ ok: false, code: "ECONNREFUSED", message: "connect ECONNREFUSED" }), "error");
  assert.equal(probeOutcome({ ok: false, code: "ETIMEDOUT" }), "error");
});

test("passes only when 1.0 and 1.1 are refused and 1.2 is accepted", () => {
  assert.deepEqual(verdict(all("refused")), { ok: true, problems: [] });
});

test("fails when an old version is accepted", () => {
  const result = verdict({ TLSv1: "refused", "TLSv1.1": "accepted", "TLSv1.2": "accepted" });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /TLSv1\.1 was accepted/);
});

test("a client-side refusal can't pass for the server's", () => {
  const result = verdict(all("client-cannot-offer"));
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /inconclusive/);
});

test("other errors on the old versions are inconclusive, not a pass", () => {
  assert.equal(verdict(all("error")).ok, false);
});

test("fails when 1.2 itself isn't accepted", () => {
  const result = verdict(all("refused", "error"));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /TLSv1\.2 was not accepted/);
});

test("set-cloudflare raises 1.0 and 1.1 to 1.2", () => {
  assert.deepEqual(planZoneChange("1.0"), { change: true, value: "1.2" });
  assert.deepEqual(planZoneChange("1.1"), { change: true, value: "1.2" });
});

test("set-cloudflare leaves 1.2 and 1.3 alone (idempotent, never lowers)", () => {
  assert.deepEqual(planZoneChange("1.2"), { change: false, value: "1.2" });
  assert.deepEqual(planZoneChange("1.3"), { change: false, value: "1.3" });
});

test("set-cloudflare refuses a value it doesn't know", () => {
  assert.throws(() => planZoneChange("2.0"), /unexpected/);
  assert.throws(() => planZoneChange(undefined), /unexpected/);
});

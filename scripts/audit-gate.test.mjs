import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EXCEPTION_DAYS, advisoriesFrom, parseExceptions, verdict } from "./audit-gate.mjs";

const TODAY = Date.UTC(2026, 10, 17);
const ID = "GHSA-fc5q-39xc-vjpf";
const OTHER = "GHSA-g3hv-75wg-m249";

const advisory = (id, severity, name = "picomatch") => ({
  name,
  severity,
  title: "a title",
  url: `https://github.com/advisories/${id}`,
});
const report = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities });
const exception = (over = {}) => ({
  id: ID,
  packages: ["picomatch"],
  reason: "no patched release; build-time only",
  granted: "2026-11-17",
  expires: "2026-12-17",
  ...over,
});
const run = (vulns, rows = []) => verdict(advisoriesFrom(report(vulns)), parseExceptions(rows, TODAY), TODAY);

test("a high advisory without an exception fails", () => {
  const r = run({ picomatch: { via: [advisory(ID, "high")] } });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /GHSA-fc5q-39xc-vjpf \(high, picomatch\).*Not in/);
});

test("a critical advisory fails too", () => {
  assert.equal(run({ x: { via: [advisory(ID, "critical", "x")] } }).ok, false);
});

test("moderate and low advisories never fail", () => {
  const r = run({ a: { via: [advisory(ID, "moderate", "a")] }, b: { via: [advisory(OTHER, "low", "b")] } });
  assert.deepEqual([r.ok, r.failures, r.waived], [true, [], []]);
});

test("a current exception waives exactly its advisory", () => {
  const r = run({ picomatch: { via: [advisory(ID, "high")] }, other: { via: [advisory(OTHER, "high", "other")] } }, [exception()]);
  assert.equal(r.ok, false);
  assert.equal(r.waived.length, 1);
  assert.match(r.waived[0], /GHSA-fc5q-39xc-vjpf.*until 2026-12-17/);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /GHSA-g3hv-75wg-m249/);
});

test("an exception holds through its expiry day and fails the day after", () => {
  const vulns = { picomatch: { via: [advisory(ID, "high")] } };
  assert.equal(run(vulns, [exception({ expires: "2026-11-17" })]).ok, true);
  const r = run(vulns, [exception({ granted: "2026-11-01", expires: "2026-11-16" })]);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /expired on 2026-11-16/);
});

test("transitive entries (string via) are not advisories; one advisory across packages counts once", () => {
  const advisories = advisoriesFrom(
    report({
      vite: { via: ["picomatch", "tinyglobby"] },
      picomatch: { via: [advisory(ID, "high")] },
      fdir: { via: [advisory(ID, "high", "picomatch"), "picomatch"] },
    }),
  );
  assert.equal(advisories.length, 1);
  assert.deepEqual([...advisories[0].packages], ["picomatch"]);
});

test("an exception no longer reported is listed as unused, not a failure", () => {
  const r = run({}, [exception()]);
  assert.deepEqual([r.ok, r.unused], [true, [ID]]);
});

test("output that isn't an audit v2 report fails closed", () => {
  assert.throws(() => advisoriesFrom(null), /v2/);
  assert.throws(() => advisoriesFrom({ vulnerabilities: {} }), /v2/);
  assert.throws(() => advisoriesFrom({ auditReportVersion: 2, error: { summary: "network" } }), /npm audit failed: network/);
  assert.throws(() => advisoriesFrom(report(undefined)), /no vulnerabilities/);
  assert.throws(() => advisoriesFrom(report({ x: {} })), /no via/);
  assert.throws(() => advisoriesFrom(report({ x: { via: [{ severity: "high", url: "https://example.com/x" }] } })), /GHSA/);
  assert.throws(() => advisoriesFrom(report({ x: { via: [{ url: `https://github.com/advisories/${ID}` }] } })), /severity/);
});

test("an unknown or differently cased severity fails closed instead of being skipped", () => {
  assert.throws(() => advisoriesFrom(report({ x: { via: [advisory(ID, "HIGH", "x")] } })), /unknown severity/);
  assert.throws(() => advisoriesFrom(report({ x: { via: [advisory(ID, "severe", "x")] } })), /unknown severity/);
});

test("an exception covers only the packages it names", () => {
  const r = run({ picomatch: { via: [advisory(ID, "high"), advisory(ID, "high", "other-glob")] } }, [exception()]);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /doesn't cover other-glob/);
  assert.equal(run({ x: { via: [advisory(ID, "high", "other-glob")] } }, [exception({ packages: ["other-glob"] })]).ok, true);
});

test("exceptions are validated", () => {
  assert.throws(() => parseExceptions({}, TODAY), /array/);
  assert.throws(() => parseExceptions([exception({ id: "CVE-2026-1" })], TODAY), /GHSA/);
  assert.throws(() => parseExceptions([exception({ reason: "because" })], TODAY), /reason/);
  assert.throws(() => parseExceptions([exception({ expires: "2026-02-30" })], TODAY), /real date/);
  assert.throws(() => parseExceptions([exception({ expires: "17/12/2026" })], TODAY), /real date/);
  assert.throws(() => parseExceptions([{ ...exception(), extra: 1 }], TODAY), /exactly/);
  const { granted: _g, ...noGranted } = exception();
  assert.throws(() => parseExceptions([noGranted], TODAY), /exactly/);
  assert.throws(() => parseExceptions([exception(), exception()], TODAY), /twice/);
  assert.throws(() => parseExceptions([exception({ packages: [] })], TODAY), /packages/);
  assert.throws(() => parseExceptions([exception({ packages: "picomatch" })], TODAY), /packages/);
  assert.throws(() => parseExceptions([exception({ packages: ["Not A Name"] })], TODAY), /packages/);
  assert.throws(() => parseExceptions([exception({ granted: "2026-11-18" })], TODAY), /future/);
  assert.throws(() => parseExceptions([exception({ granted: "2026-11-10", expires: "2026-11-09" })], TODAY), /before/);
  assert.throws(() => parseExceptions([[]], TODAY), /not an object/);
});

test(`an exception may run at most ${MAX_EXCEPTION_DAYS} days after it was granted, whenever CI runs`, () => {
  const day = (n) => new Date(TODAY + n * 86400000).toISOString().slice(0, 10);
  assert.equal(parseExceptions([exception({ expires: day(MAX_EXCEPTION_DAYS) })], TODAY).size, 1);
  assert.throws(() => parseExceptions([exception({ expires: day(MAX_EXCEPTION_DAYS + 1) })], TODAY), /more than/);
  // Renewing by moving only `expires` forward fails: the cap counts from `granted`, not from the run date.
  const later = TODAY + 60 * 86400000;
  assert.throws(() => parseExceptions([exception({ expires: day(MAX_EXCEPTION_DAYS + 30) })], later), /more than/);
});

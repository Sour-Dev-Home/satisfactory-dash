import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TARGET_HOSTS,
  FIXTURE_SOURCE,
  assertFixturePayloads,
  assertLoadDatabaseName,
  assertLoadDatabaseUrl,
  assertLocalTarget,
  openSeed,
  sealPayloads,
  snapshotBody,
} from "../lib/guards.mjs";

const ON = { LOAD_TEST: "1" };

test("the seed accepts a database whose name ends in _load, with LOAD_TEST=1", () => {
  assert.equal(assertLoadDatabaseUrl("postgres://satis_app:pw@127.0.0.1:5432/satis_load", ON), "satis_load");
  assert.equal(assertLoadDatabaseUrl("postgresql://u:p@postgres/ci_run_load", ON), "ci_run_load");
});

test("the seed refuses without LOAD_TEST=1, whatever the database", () => {
  for (const env of [{}, { LOAD_TEST: "0" }, { LOAD_TEST: "true" }, { LOAD_TEST: " 1" }, { LOAD_TEST: "yes" }]) {
    assert.throws(() => assertLoadDatabaseUrl("postgres://u:p@127.0.0.1/satis_load", env), /LOAD_TEST=1/);
  }
});

test("the seed refuses production-like database names", () => {
  for (const name of ["satis", "satis_loader", "satis_load_x", "load", "_load", "satis-load", "satis_LOAD", "satis_load "]) {
    assert.throws(() => assertLoadDatabaseName(name), /_load/, name);
  }
  assert.equal(assertLoadDatabaseName("satis_load"), "satis_load");
});

test("the seed refuses a database URL it cannot read the name from, or one that could name another database", () => {
  const refused = [
    undefined,
    "",
    "not a url",
    "mysql://u:p@127.0.0.1/satis_load",
    "postgres://u:p@127.0.0.1/",
    "postgres://u:p@127.0.0.1",
    "postgres://u:p@127.0.0.1/satis_load?dbname=satis",
    "postgres://u:p@127.0.0.1/satis_load?database=satis",
    "postgres://u:p@127.0.0.1/satis_load?options=-c%20search_path%3Dx",
    "postgres://u:p@127.0.0.1/satis_load/extra",
    "postgres://u:p@127.0.0.1/satis%5Fload%00",
  ];
  for (const url of refused) assert.throws(() => assertLoadDatabaseUrl(url, ON), Error, String(url));
});

test("a percent-encoded name is checked decoded", () => {
  assert.equal(assertLoadDatabaseUrl("postgres://u:p@127.0.0.1/satis%5Fload", ON), "satis_load");
  assert.throws(() => assertLoadDatabaseUrl("postgres://u:p@127.0.0.1/satis%5Fload%5Fx", ON), /_load/);
});

test("k6 accepts only the loopback names and the compose service, any port", () => {
  assert.deepEqual([...ALLOWED_TARGET_HOSTS], ["127.0.0.1", "localhost", "backend"]);
  assert.equal(assertLocalTarget("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
  assert.equal(assertLocalTarget("http://localhost:3001/"), "http://localhost:3001");
  assert.equal(assertLocalTarget("http://LOCALHOST:3001"), "http://localhost:3001");
  assert.equal(assertLocalTarget("http://backend:3001"), "http://backend:3001");
  assert.equal(assertLocalTarget("https://localhost"), "https://localhost");
});

test("k6 refuses every other target, and there is no override", () => {
  const refused = [
    undefined,
    "",
    "127.0.0.1:3001",
    "ftp://127.0.0.1",
    "http://127.0.0.2:3001",
    "http://127.0.0.1.example.com",
    "http://localhost.example.com",
    "http://example.com",
    "http://api.satis-manager.com",
    "https://api.satis-manager.com",
    "http://[::1]:3001",
    "http://0.0.0.0:3001",
    "http://localhost@example.com",
    "http://user:pw@localhost:3001",
    "http://localhost\\@example.com",
    "http://localhost#@example.com",
    "http://localhost?x=@example.com",
    "http://localhost:99999",
    "http://localhost:3001/api",
    "http://local host",
    " http://localhost",
    "aws-precutover",
  ];
  for (const target of refused) assert.throws(() => assertLocalTarget(target), /target/, String(target));
});

test("a TARGET=aws-precutover environment does not open the guard", () => {
  assert.throws(() => assertLocalTarget("https://api.satis-manager.com", { TARGET: "aws-precutover" }), /target/);
});

const fixtures = {
  agentEnrollRequest: { code: "AB3D-7XQ2", agentVersion: "0.1.0" },
  agentSnapshotRequestFull: { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z", reachable: true, paused: false, factory: [] },
  agentSnapshotRequestPartial: { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:05.000Z", reachable: true, paused: false },
};

test("payloads are sealed from the shared fixtures and open only unchanged", () => {
  const sealed = sealPayloads(fixtures);
  assert.equal(sealed.source, FIXTURE_SOURCE);
  assert.equal(FIXTURE_SOURCE, "@satisfactory-dash/shared/fixtures");
  assert.deepEqual(sealed.payloads.full, fixtures.agentSnapshotRequestFull);
  assert.deepEqual(sealed.payloads.partial, fixtures.agentSnapshotRequestPartial);
  assert.equal(sealed.payloads.agentVersion, "0.1.0");
  assert.equal(assertFixturePayloads(sealed), sealed);
});

test("a hand-edited payload, a foreign source or a missing checksum is refused", () => {
  const sealed = sealPayloads(fixtures);
  const edited = structuredClone(sealed);
  edited.payloads.full.reachable = false;
  assert.throws(() => assertFixturePayloads(edited), /fixtures/);
  assert.throws(() => assertFixturePayloads({ ...sealed, source: "production" }), /fixtures/);
  assert.throws(() => assertFixturePayloads({ ...sealed, checksum: undefined }), /fixtures/);
  assert.throws(() => assertFixturePayloads(undefined), /fixtures/);
  const extra = structuredClone(sealed);
  extra.payloads.other = { a: 1 };
  assert.throws(() => assertFixturePayloads(extra), /fixtures/);
});

test("sealing refuses fixtures that lack a snapshot", () => {
  assert.throws(() => sealPayloads({ ...fixtures, agentSnapshotRequestFull: undefined }), /agentSnapshotRequestFull/);
  assert.throws(() => sealPayloads({}), /fixture/);
});

test("the checksum does not depend on key order", () => {
  const reordered = {
    agentEnrollRequest: { agentVersion: "0.1.0", code: "AB3D-7XQ2" },
    agentSnapshotRequestPartial: { paused: false, reachable: true, observedAt: "2026-09-26T12:00:05.000Z", agentVersion: "0.1.0" },
    agentSnapshotRequestFull: { factory: [], paused: false, reachable: true, observedAt: "2026-09-26T12:00:00.000Z", agentVersion: "0.1.0" },
  };
  assert.equal(sealPayloads(reordered).checksum, sealPayloads(fixtures).checksum);
});

test("a snapshot body is the fixture with only observedAt replaced", () => {
  const sealed = sealPayloads(fixtures);
  const body = snapshotBody(sealed, "full", "2026-10-20T10:00:00.000Z");
  assert.deepEqual(body, { ...fixtures.agentSnapshotRequestFull, observedAt: "2026-10-20T10:00:00.000Z" });
  assert.deepEqual(snapshotBody(sealed, "partial", "2026-10-20T10:00:05.000Z"), {
    ...fixtures.agentSnapshotRequestPartial,
    observedAt: "2026-10-20T10:00:05.000Z",
  });
  assert.throws(() => snapshotBody(sealed, "other", "2026-10-20T10:00:00.000Z"), /part/);
  // The sealed copy is never changed by building a body.
  assert.equal(sealed.payloads.full.observedAt, "2026-09-26T12:00:00.000Z");
});

const seedFile = (overrides = {}) =>
  JSON.stringify({
    version: 1,
    createdAt: "2026-10-20T10:00:00.000Z",
    target: "http://127.0.0.1:3001",
    payloads: sealPayloads(fixtures),
    agents: [{ serverId: "load-001", secret: "s1" }],
    users: [{ serverId: "load-001", cookie: "c1" }],
    ...overrides,
  });

test("k6 opens a seed file only after every guard", () => {
  const { base, seed } = openSeed(seedFile(), {});
  assert.equal(base, "http://127.0.0.1:3001");
  assert.equal(seed.agents[0].secret, "s1");
  assert.equal(openSeed(seedFile(), { LOAD_TARGET: "http://backend:3001" }).base, "http://backend:3001");
});

test("k6 refuses a seed file whose target, payloads or identities are wrong", () => {
  assert.throws(() => openSeed(seedFile({ target: "https://api.satis-manager.com" }), {}), /target/);
  assert.throws(() => openSeed(seedFile(), { LOAD_TARGET: "https://api.satis-manager.com" }), /target/);
  assert.throws(() => openSeed(seedFile({ target: "http://example.com" }), { TARGET: "aws-precutover" }), /target/);
  const sealed = sealPayloads(fixtures);
  sealed.payloads.partial = { ...sealed.payloads.partial, reachable: false };
  assert.throws(() => openSeed(seedFile({ payloads: sealed }), {}), /fixtures/);
  assert.throws(() => openSeed("{", {}), /JSON/);
  assert.throws(() => openSeed(seedFile({ version: 2 }), {}), /version 1/);
  assert.throws(() => openSeed(seedFile({ agents: [{ serverId: "load-001" }] }), {}), /malformed/);
  assert.throws(() => openSeed(seedFile({ users: [{ serverId: "../x", cookie: "c" }] }), {}), /malformed/);
  assert.throws(() => openSeed(seedFile({ users: [null] }), {}), /malformed/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { sealPayloads } from "../lib/guards.mjs";
import { createHttp, parseSeedArgs, runSeed } from "../lib/seed.mjs";

const fixtures = {
  agentEnrollRequest: { code: "AB3D-7XQ2", agentVersion: "0.1.0" },
  agentSnapshotRequestFull: { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z", reachable: true, paused: false },
  agentSnapshotRequestPartial: { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:05.000Z", reachable: true, paused: false },
};

test("the CLI takes --servers N --users M, both required positive integers", () => {
  assert.deepEqual(parseSeedArgs(["--servers", "10", "--users", "30"]), { servers: 10, users: 30 });
  assert.deepEqual(parseSeedArgs(["--users", "3", "--servers", "1"]), { servers: 1, users: 3 });
  for (const argv of [[], ["--servers", "10"], ["--servers", "0", "--users", "1"], ["--servers", "1.5", "--users", "1"], ["--servers", "x", "--users", "1"], ["--servers", "1", "--users", "1", "--extra"], ["--servers", "201", "--users", "1"], ["--servers", "1", "--users", "1001"], ["--servers", "1", "--servers", "2", "--users", "1"]]) {
    assert.throws(() => parseSeedArgs(argv), /Usage/, argv.join(" "));
  }
});

/** A fake backend: records calls, answers the enrolment routes, and limits like the real ones when asked. */
function fakeBackend({ limitEvery = 0 } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    n++;
    if (limitEvery > 0 && n % limitEvery === 0) return new Response("{}", { status: 429, headers: { "Retry-After": "7" } });
    const path = new URL(url).pathname;
    if (path === "/api/auth/session") {
      return Response.json(init.headers.Cookie === "sd_session=operator-cookie" ? { authenticated: true } : { authenticated: false });
    }
    if (/^\/api\/servers\/[^/]+\/agent\/enrollment-codes$/.test(path)) {
      return Response.json({ code: `CODE-${path.split("/")[3]}`, expiresAt: "2026-10-20T10:10:00.000Z" }, { status: 201 });
    }
    if (path === "/agent/v1/enroll") {
      const { code } = JSON.parse(init.body);
      return Response.json({ agentSecret: `secret-for-${code}`, serverId: code.slice(5), cadence: {} }, { status: 201 });
    }
    if (path === "/agent/v1/snapshots") return Response.json({ cadence: {}, commandsPending: false });
    return new Response("{}", { status: 404 });
  };
  return { calls, fetch };
}

function fakeDb() {
  const log = [];
  let users = 0;
  return {
    log,
    operator: async () => ({ userId: "op", cookie: "operator-cookie" }),
    createServer: async ({ publicId }) => (log.push(["server", publicId]), { serverUuid: `uuid-${publicId}` }),
    addMember: async (member) => void log.push(["member", member.serverUuid, member.userId, member.role]),
    createUser: async () => ({ userId: `user-${++users}` }),
    startSession: async (userId) => `cookie-${userId}`,
  };
}

const NOW = () => Date.parse("2026-10-20T10:00:00.000Z");

test("each server gets an enrolment code from the real route, consumed through the enrol route", async () => {
  const backend = fakeBackend();
  const db = fakeDb();
  const sleeps = [];
  const http = createHttp({ fetch: backend.fetch, base: "http://127.0.0.1:3001", sleep: async (ms) => void sleeps.push(ms) });
  const seed = await runSeed({ servers: 2, users: 3, target: "http://127.0.0.1:3001", db, http, sealed: sealPayloads(fixtures), now: NOW });

  const codeCalls = backend.calls.filter((c) => c.url.endsWith("/agent/enrollment-codes"));
  assert.deepEqual(
    codeCalls.map((c) => [c.url, c.method, c.headers.Cookie]),
    [
      ["http://127.0.0.1:3001/api/servers/load-001/agent/enrollment-codes", "POST", "sd_session=operator-cookie"],
      ["http://127.0.0.1:3001/api/servers/load-002/agent/enrollment-codes", "POST", "sd_session=operator-cookie"],
    ],
  );
  const enrolCalls = backend.calls.filter((c) => c.url.endsWith("/agent/v1/enroll"));
  assert.deepEqual(enrolCalls.map((c) => c.body), [
    { code: "CODE-load-001", agentVersion: "0.1.0" },
    { code: "CODE-load-002", agentVersion: "0.1.0" },
  ]);
  for (const call of enrolCalls) assert.equal(call.headers.Cookie, undefined);
  assert.deepEqual(seed.agents, [
    { serverId: "load-001", secret: "secret-for-CODE-load-001" },
    { serverId: "load-002", secret: "secret-for-CODE-load-002" },
  ]);
  assert.deepEqual(sleeps, []);
});

test("the operator owns every load server and each user is a viewer of one, round robin, with a session", async () => {
  const backend = fakeBackend();
  const db = fakeDb();
  const http = createHttp({ fetch: backend.fetch, base: "http://127.0.0.1:3001", sleep: async () => {} });
  const seed = await runSeed({ servers: 2, users: 3, target: "http://127.0.0.1:3001", db, http, sealed: sealPayloads(fixtures), now: NOW });
  const members = db.log.filter(([kind]) => kind === "member");
  assert.deepEqual(members, [
    ["member", "uuid-load-001", "op", "owner"],
    ["member", "uuid-load-002", "op", "owner"],
    ["member", "uuid-load-001", "user-1", "viewer"],
    ["member", "uuid-load-002", "user-2", "viewer"],
    ["member", "uuid-load-001", "user-3", "viewer"],
  ]);
  assert.deepEqual(seed.users, [
    { serverId: "load-001", cookie: "cookie-user-1" },
    { serverId: "load-002", cookie: "cookie-user-2" },
    { serverId: "load-001", cookie: "cookie-user-3" },
  ]);
});

test("every agent sends one fixture snapshot after enrolling, so users never poll an empty server", async () => {
  const backend = fakeBackend();
  const http = createHttp({ fetch: backend.fetch, base: "http://127.0.0.1:3001", sleep: async () => {} });
  await runSeed({ servers: 1, users: 1, target: "http://127.0.0.1:3001", db: fakeDb(), http, sealed: sealPayloads(fixtures), now: NOW });
  const warm = backend.calls.filter((c) => c.url.endsWith("/agent/v1/snapshots"));
  assert.equal(warm.length, 1);
  assert.equal(warm[0].headers.Authorization, "Bearer secret-for-CODE-load-001");
  assert.deepEqual(warm[0].body, { ...fixtures.agentSnapshotRequestFull, observedAt: "2026-10-20T10:00:00.000Z" });
});

test("the seed file carries the target, the sealed payloads and no database URL", async () => {
  const backend = fakeBackend();
  const http = createHttp({ fetch: backend.fetch, base: "http://127.0.0.1:3001", sleep: async () => {} });
  const sealed = sealPayloads(fixtures);
  const seed = await runSeed({ servers: 1, users: 1, target: "http://127.0.0.1:3001", db: fakeDb(), http, sealed, now: NOW });
  assert.equal(seed.version, 1);
  assert.equal(seed.target, "http://127.0.0.1:3001");
  assert.equal(seed.createdAt, "2026-10-20T10:00:00.000Z");
  assert.deepEqual(seed.payloads, sealed);
  assert.doesNotMatch(JSON.stringify(seed), /postgres/);
});

test("a 429 is waited out for its Retry-After, never bypassed", async () => {
  const backend = fakeBackend({ limitEvery: 2 });
  const sleeps = [];
  const http = createHttp({ fetch: backend.fetch, base: "http://127.0.0.1:3001", sleep: async (ms) => void sleeps.push(ms) });
  const seed = await runSeed({ servers: 2, users: 1, target: "http://127.0.0.1:3001", db: fakeDb(), http, sealed: sealPayloads(fixtures), now: NOW });
  assert.equal(seed.agents.length, 2);
  assert.ok(sleeps.length > 0);
  assert.ok(sleeps.every((ms) => ms === 7000));
});

test("a Retry-After that is missing, junk or huge is bounded", async () => {
  const answers = [
    new Response("{}", { status: 429 }),
    new Response("{}", { status: 429, headers: { "Retry-After": "soon" } }),
    new Response("{}", { status: 429, headers: { "Retry-After": "100000" } }),
    Response.json({ ok: true }),
  ];
  const sleeps = [];
  const http = createHttp({ fetch: async () => answers.shift(), base: "http://127.0.0.1:3001", sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(await http.json({ method: "GET", path: "/api/health" }), { ok: true });
  assert.deepEqual(sleeps, [1000, 1000, 120_000]);
});

test("rate limiting that never ends gives up instead of looping", async () => {
  const http = createHttp({
    fetch: async () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }),
    base: "http://127.0.0.1:3001",
    sleep: async () => {},
    maxRetries: 3,
  });
  await assert.rejects(http.json({ method: "GET", path: "/api/health" }), /429/);
});

/** A fetch that accepts the operator's session check and answers everything else with `answer()`. */
const sessionOk = (answer) => async (url) => (url.endsWith("/api/auth/session") ? Response.json({ authenticated: true }) : answer());

test("any other failure stops the seed with the route and status, never a body or a secret", async () => {
  const http = createHttp({
    fetch: sessionOk(() => new Response(JSON.stringify({ error: { message: "secret-ish detail" } }), { status: 403 })),
    base: "http://127.0.0.1:3001",
    sleep: async () => {},
  });
  await assert.rejects(
    runSeed({ servers: 1, users: 1, target: "http://127.0.0.1:3001", db: fakeDb(), http, sealed: sealPayloads(fixtures), now: NOW }),
    (err) => /POST \/api\/servers\/load-001\/agent\/enrollment-codes answered 403/.test(err.message) && !/secret/.test(err.message),
  );
});

test("an answer without the expected field is refused", async () => {
  const http = createHttp({ fetch: sessionOk(() => Response.json({ nope: 1 }, { status: 201 })), base: "http://127.0.0.1:3001", sleep: async () => {} });
  await assert.rejects(
    runSeed({ servers: 1, users: 1, target: "http://127.0.0.1:3001", db: fakeDb(), http, sealed: sealPayloads(fixtures), now: NOW }),
    /enrolment code/,
  );
});

test("a target that does not accept a session from the load database stops the seed before anything is created", async () => {
  const db = fakeDb();
  const calls = [];
  const http = createHttp({
    fetch: async (url) => (calls.push(url), Response.json({ authenticated: false })),
    base: "http://127.0.0.1:3001",
    sleep: async () => {},
  });
  await assert.rejects(
    runSeed({ servers: 1, users: 1, target: "http://127.0.0.1:3001", db, http, sealed: sealPayloads(fixtures), now: NOW }),
    /load database/,
  );
  assert.deepEqual(db.log, []);
  assert.deepEqual(calls, ["http://127.0.0.1:3001/api/auth/session"]);
});

test("the HTTP client refuses a base that is not a local target", () => {
  assert.throws(() => createHttp({ fetch: async () => new Response(), base: "https://api.satis-manager.com", sleep: async () => {} }), /target/);
});

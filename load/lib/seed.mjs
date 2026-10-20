// ADR-0037 §3: what the load seed does, apart from the database and the network (backend/scripts/load-seed.ts wires
// those in), so it can be tested with fakes.
//
//   0. A check that the backend at the target accepts a session made in this database (it is the load backend).
//   1. N servers (`load-001`...), each owned by the operator account.
//   2. M users, each a viewer of one server (round robin) with a session.
//   3. For each server: an enrolment code from POST /api/servers/:serverId/agent/enrollment-codes (as the operator),
//      consumed through POST /agent/v1/enroll, then one fixture snapshot so its live routes have data.
//
// A 429 is waited out for its Retry-After: the limiters stay on, so a large seed simply takes longer (about a minute
// per 10 servers, the enrolment limits).
import { assertLocalTarget, snapshotBody } from "./guards.mjs";

export const USAGE = "Usage: tsx backend/scripts/load-seed.ts --servers N --users M (N 1-200, M 1-1000)";
const MAX_SERVERS = 200;
const MAX_USERS = 1000;

export function parseSeedArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const key = flag === "--servers" ? "servers" : flag === "--users" ? "users" : undefined;
    if (key === undefined || values.has(key) || !/^[1-9]\d{0,3}$/.test(argv[i + 1] ?? "")) throw new Error(USAGE);
    values.set(key, Number(argv[i + 1]));
  }
  const servers = values.get("servers");
  const users = values.get("users");
  if (!(servers <= MAX_SERVERS) || !(users <= MAX_USERS)) throw new Error(USAGE);
  return { servers, users };
}

const DEFAULT_MAX_RETRIES = 30;
const MAX_WAIT_MS = 120_000;

/** Retry-After in whole seconds, as the backend sends it; anything unreadable waits one second. */
function retryAfterMs(response) {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isInteger(seconds) && seconds >= 1 ? Math.min(seconds * 1000, MAX_WAIT_MS) : 1000;
}

/**
 * A small JSON client for the local backend. `json({ method, path, cookie?, bearer?, body? })` answers the parsed body
 * of a 2xx; a 429 is retried after its Retry-After (at most `maxRetries` times); anything else throws with the method,
 * the path and the status only (an error body can quote input, and a request can carry a secret).
 */
export function createHttp({ fetch, base, sleep, maxRetries = DEFAULT_MAX_RETRIES }) {
  const origin = assertLocalTarget(base);
  return {
    async json({ method, path, cookie, bearer, body }) {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (cookie !== undefined) headers.Cookie = `sd_session=${cookie}`;
      if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
      const init = body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${origin}${path}`, init);
        if (response.status === 429 && attempt < maxRetries) {
          await sleep(retryAfterMs(response));
          continue;
        }
        if (response.status < 200 || response.status > 299) {
          throw new Error(`${method} ${path} answered ${response.status}.`);
        }
        return response.json();
      }
    },
  };
}

const pad = (n) => String(n).padStart(3, "0");

function field(answer, name, what) {
  const value = answer?.[name];
  if (typeof value !== "string" || value === "") throw new Error(`The backend's answer has no ${what}.`);
  return value;
}

/**
 * Runs the seed and returns the seed file's content. `db` is the database half (operator, createServer, addMember,
 * createUser, startSession), `http` a `createHttp` client for `target`, `sealed` the sealed fixture payloads.
 */
export async function runSeed({ servers, users, target, db, http, sealed, now = Date.now }) {
  const operator = await db.operator();
  // The session exists only in the load database, so a backend that accepts it is the one on that database (and not,
  // say, the live backend on the same machine).
  const session = await http.json({ method: "GET", path: "/api/auth/session", cookie: operator.cookie });
  if (session?.authenticated !== true) {
    throw new Error("LOAD_TARGET does not accept a session from this database: point it at the backend running on the load database.");
  }
  const created = [];
  for (let i = 1; i <= servers; i++) {
    const publicId = `load-${pad(i)}`;
    const { serverUuid } = await db.createServer({ publicId, displayName: `Load server ${pad(i)}` });
    await db.addMember({ serverUuid, userId: operator.userId, role: "owner" });
    created.push({ publicId, serverUuid });
  }

  const sessions = [];
  for (let j = 1; j <= users; j++) {
    const server = created[(j - 1) % created.length];
    const { userId } = await db.createUser({ displayName: `Load user ${pad(j)}` });
    await db.addMember({ serverUuid: server.serverUuid, userId, role: "viewer" });
    sessions.push({ serverId: server.publicId, cookie: await db.startSession(userId) });
  }

  const agents = [];
  for (const { publicId } of created) {
    const scoped = `/api/servers/${publicId}/agent/enrollment-codes`;
    const code = field(await http.json({ method: "POST", path: scoped, cookie: operator.cookie }), "code", "enrolment code");
    const enrolled = await http.json({ method: "POST", path: "/agent/v1/enroll", body: { code, agentVersion: sealed.payloads.agentVersion } });
    const secret = field(enrolled, "agentSecret", "agent secret");
    await http.json({
      method: "POST",
      path: "/agent/v1/snapshots",
      bearer: secret,
      body: snapshotBody(sealed, "full", new Date(now()).toISOString()),
    });
    agents.push({ serverId: publicId, secret });
  }

  return { version: 1, createdAt: new Date(now()).toISOString(), target, payloads: sealed, agents, users: sessions };
}

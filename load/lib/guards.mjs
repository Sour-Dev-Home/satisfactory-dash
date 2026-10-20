// ADR-0037 §3: the load kit's guards. Plain JavaScript with no imports, so the same file runs in Node (the seed, the
// report and their tests) and in k6 (the scenarios). Every guard throws; nothing here has an override.
//
//   - The seed writes only to a database whose name ends in `_load`, on 127.0.0.1, localhost or the compose service
//     `postgres`, and only with LOAD_TEST=1 set.
//   - k6 sends only to 127.0.0.1, localhost or the compose service name. The ADR's TARGET=aws-precutover is not
//     implemented (owner, 2026-10-19: load runs stay on the local stack), so no environment variable opens it.
//   - Every snapshot k6 sends is a shared fixture (`packages/shared/fixtures`), sealed by the seed with a checksum,
//     with only `observedAt` replaced.

export const ALLOWED_TARGET_HOSTS = Object.freeze(["127.0.0.1", "localhost", "backend"]);
export const FIXTURE_SOURCE = "@satisfactory-dash/shared/fixtures";

/** Where a load database may live: this machine, or the compose Postgres service. */
export const ALLOWED_DATABASE_HOSTS = Object.freeze(["127.0.0.1", "localhost", "postgres"]);
const LOAD_DATABASE_NAME =/^[A-Za-z0-9_]*[A-Za-z0-9]_load$/;
/** The only connection-string parameter allowed: one that cannot name another database or change the search path. */
const ALLOWED_DATABASE_PARAMS = new Set(["sslmode"]);

/** The database name, if it is a load database (ends in `_load`); otherwise throws. */
export function assertLoadDatabaseName(name) {
  if (typeof name !== "string" || !LOAD_DATABASE_NAME.test(name)) {
    throw new Error("Refused: the database name must end in _load (production's is satis).");
  }
  return name;
}

/**
 * The database name in a `postgres://` URL, after checking that LOAD_TEST=1 is set and the name ends in `_load`.
 * A URL with any parameter other than `sslmode` is refused, since `dbname=` or `options=` could point the connection
 * somewhere the path does not say.
 */
export function assertLoadDatabaseUrl(databaseUrl, env) {
  if (env?.LOAD_TEST !== "1") {
    throw new Error("Refused: set LOAD_TEST=1 to seed a load database.");
  }
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Refused: DATABASE_URL is not a postgres:// URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Refused: DATABASE_URL is not a postgres:// URL.");
  }
  // A host-less URL would fall back to PGHOST; a remote host is never the local stack.
  if (!ALLOWED_DATABASE_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(`Refused: the load database must be on ${ALLOWED_DATABASE_HOSTS.join(", ")}.`);
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_DATABASE_PARAMS.has(key)) throw new Error(`Refused: DATABASE_URL may not set "${key}".`);
  }
  const path = url.pathname.replace(/^\//, "");
  if (path === "" || path.includes("/")) {
    throw new Error("Refused: DATABASE_URL must name exactly one database, ending in _load.");
  }
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    throw new Error("Refused: the database name in DATABASE_URL cannot be read.");
  }
  return assertLoadDatabaseName(name);
}

// scheme://host[:port][/], with no user info, query or fragment. Parsed by hand (k6 has no WHATWG URL), so every
// character that could end the host early (@ \ ? # / whitespace) is outside the host's class.
const TARGET = /^(https?):\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/;

/**
 * The base URL k6 sends to (`scheme://host[:port]`, no trailing slash), if its host is one of ALLOWED_TARGET_HOSTS;
 * otherwise throws. The second argument is ignored on purpose: no environment variable widens the list.
 */
export function assertLocalTarget(target, _env) {
  const match = typeof target === "string" ? TARGET.exec(target) : null;
  const host = match?.[2].toLowerCase();
  const port = match?.[3] === undefined ? undefined : Number(match[3]);
  if (!match || !ALLOWED_TARGET_HOSTS.includes(host) || (port !== undefined && (port < 1 || port > 65_535))) {
    throw new Error(`Refused: the load target must be http(s)://${ALLOWED_TARGET_HOSTS.join(" | ")}[:port]; there is no override.`);
  }
  return `${match[1]}://${host}${port === undefined ? "" : `:${port}`}`;
}

/** JSON with object keys sorted, so the checksum does not depend on key order. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 32-bit FNV-1a, hex. It catches a hand-edited payload; it is not a defence against someone who recomputes it. */
function checksumOf(payloads) {
  const text = stableStringify(payloads);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const PAYLOAD_KEYS = ["agentVersion", "full", "partial"];

/**
 * The seed's half: picks the agent payloads out of the shared fixtures module and seals them. `full` is a snapshot
 * with every part (status, power, factory, players); `partial` is status and power only.
 */
export function sealPayloads(fixtures) {
  for (const name of ["agentEnrollRequest", "agentSnapshotRequestFull", "agentSnapshotRequestPartial"]) {
    if (fixtures?.[name] === null || typeof fixtures?.[name] !== "object") {
      throw new Error(`The shared fixture ${name} is missing.`);
    }
  }
  const payloads = {
    agentVersion: fixtures.agentEnrollRequest.agentVersion,
    full: fixtures.agentSnapshotRequestFull,
    partial: fixtures.agentSnapshotRequestPartial,
  };
  return { source: FIXTURE_SOURCE, checksum: checksumOf(payloads), payloads };
}

/** k6's half: the sealed payloads, if they are exactly what the seed sealed from the fixtures; otherwise throws. */
export function assertFixturePayloads(sealed) {
  const keys = sealed?.payloads !== null && typeof sealed?.payloads === "object" ? Object.keys(sealed.payloads).sort() : [];
  const ok =
    sealed?.source === FIXTURE_SOURCE &&
    keys.length === PAYLOAD_KEYS.length &&
    keys.every((key, i) => key === PAYLOAD_KEYS[i]) &&
    typeof sealed.checksum === "string" &&
    sealed.checksum === checksumOf(sealed.payloads);
  if (!ok) throw new Error(`Refused: the payloads are not the sealed ${FIXTURE_SOURCE}; run the seed again.`);
  return sealed;
}

const SERVER_ID = /^[a-z0-9-]{1,32}$/;
const isIdentity = (entry, secretKey) =>
  entry !== null && typeof entry === "object" && SERVER_ID.test(entry.serverId) && typeof entry[secretKey] === "string" && entry[secretKey] !== "";

/**
 * The seed file as k6 uses it: `{ base, seed }`, after every guard. The target is LOAD_TARGET when set, else the one
 * the seed ran against; either way it must pass `assertLocalTarget`. The payloads must be the sealed fixtures.
 */
export function openSeed(text, env) {
  let seed;
  try {
    seed = JSON.parse(text);
  } catch {
    throw new Error("Refused: the seed file is not JSON; run the seed again.");
  }
  if (seed?.version !== 1 || !Array.isArray(seed.agents) || !Array.isArray(seed.users)) {
    throw new Error("Refused: the seed file is not a version 1 seed; run the seed again.");
  }
  if (!seed.agents.every((agent) => isIdentity(agent, "secret")) || !seed.users.every((user) => isIdentity(user, "cookie"))) {
    throw new Error("Refused: the seed file has a malformed agent or user; run the seed again.");
  }
  const base = assertLocalTarget(env?.LOAD_TARGET || seed.target);
  assertFixturePayloads(seed.payloads);
  return { base, seed };
}

/** A snapshot request body: the sealed fixture for `part` ("full" or "partial") with a fresh `observedAt`. */
export function snapshotBody(sealed, part, observedAt) {
  if (part !== "full" && part !== "partial") throw new Error(`Unknown snapshot part "${part}".`);
  return { ...sealed.payloads[part], observedAt };
}

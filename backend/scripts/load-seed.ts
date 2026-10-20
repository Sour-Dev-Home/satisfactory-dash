import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as fixtures from "@satisfactory-dash/shared/fixtures";
import { withTransaction } from "../src/platform/db/transaction.js";
import { OPERATOR_SUBJECT } from "../src/modules/identity/authenticator.js";
import { startSession } from "../src/modules/identity/dbSessionStore.js";
import { createUser, findUserByIdentity } from "../src/modules/identity/repositories/userRepository.js";
import { addMember } from "../src/modules/servers/repositories/memberRepository.js";
import { ensureServer } from "../src/modules/servers/repositories/serverRepository.js";
import { assertLoadDatabaseName, assertLoadDatabaseUrl, assertLocalTarget, sealPayloads } from "../../load/lib/guards.mjs";
import { USAGE, createHttp, parseSeedArgs, runSeed } from "../../load/lib/seed.mjs";

// ADR-0037 §3: seeds a LOAD database for the k6 scenarios in load/ (runbook: docs-vault/wiki/runbooks/load-testing.md).
//
//   LOAD_TEST=1 DATABASE_URL=postgres://satis_app:...@127.0.0.1:5432/satis_load \
//     npx tsx backend/scripts/load-seed.ts --servers 10 --users 30
//
// Refuses unless LOAD_TEST=1 is set and the database's name ends in `_load` (checked in the URL and again with
// current_database() once connected). It reads no backend/.env, so a production DATABASE_URL there is never picked up.
// The backend must be running against the same database at LOAD_TARGET (default http://127.0.0.1:3001; only
// 127.0.0.1, localhost or the compose service `backend`), and must have started once so the operator account exists.
//
// Everything goes through the real code paths: server rows and memberships through the servers repositories, users
// and their sessions through the identity repositories and `startSession` (what password and Google sign-in run once
// the identity is proven), and each agent through the real enrolment-code and enrol routes, rate limits included.
// The credentials go to load/.data/seed.json (git-ignored, mode 600), which the k6 scripts read. Nothing secret is
// printed.

const SEED_FILE = fileURLToPath(new URL("../../load/.data/seed.json", import.meta.url));

let args: { servers: number; users: number };
let target: string;
let databaseUrl: string;
try {
  args = parseSeedArgs(process.argv.slice(2));
  databaseUrl = process.env.DATABASE_URL ?? "";
  assertLoadDatabaseUrl(databaseUrl, process.env);
  target = assertLocalTarget(process.env.LOAD_TARGET ?? "http://127.0.0.1:3001");
} catch (err) {
  console.error(err instanceof Error ? err.message : USAGE);
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  const current = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assertLoadDatabaseName(current.rows[0]?.name);

  const operatorUser = await findUserByIdentity(pool, "local", OPERATOR_SUBJECT);
  if (operatorUser === undefined) {
    throw new Error("No operator account yet: start the backend against this database once, then seed.");
  }
  const sessionFor = (userId: string): Promise<string> =>
    withTransaction(pool, (client) => startSession(client, userId, undefined, { provider: "load-seed" }));

  const seed = await runSeed({
    servers: args.servers,
    users: args.users,
    target,
    sealed: sealPayloads(fixtures),
    http: createHttp({ fetch, base: target, sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) }),
    db: {
      operator: async () => ({ userId: operatorUser.id, cookie: await sessionFor(operatorUser.id) }),
      createServer: async (input: { publicId: string; displayName: string }) => ({ serverUuid: (await ensureServer(pool, input)).id }),
      addMember: async (input: { serverUuid: string; userId: string; role: "owner" | "viewer" }) => {
        const result = await addMember(pool, { serverId: input.serverUuid, userId: input.userId, role: input.role, actorUserId: operatorUser.id });
        if (result !== "added" && result !== "already_member") throw new Error(`Could not add a ${input.role}: ${result}.`);
      },
      createUser: async (input: { displayName: string }) => ({ userId: (await createUser(pool, input)).id }),
      startSession: sessionFor,
    },
  });

  await mkdir(dirname(SEED_FILE), { recursive: true });
  await writeFile(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
  await chmod(SEED_FILE, 0o600);
  console.log(`Seeded ${seed.agents.length} enrolled server(s) and ${seed.users.length} user session(s) for ${target}; wrote load/.data/seed.json.`);
} catch (err) {
  console.error(`Seed failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

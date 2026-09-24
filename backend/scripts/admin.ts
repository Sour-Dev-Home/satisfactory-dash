import "dotenv/config";
import pg from "pg";
import { loadDatabaseConfig } from "../src/platform/db/config.js";
import { revokeAllSessionsAdmin, revokeUserSessionsAdmin } from "../src/modules/identity/sessionAdmin.js";

// ADR-0025: break-glass commands, run locally against the app database (DATABASE_URL in
// backend/.env). Shell access to this PC is the trust boundary. Output never includes secrets.
//
//   npm run admin -- revoke-sessions --all             sign everyone out (replaces rotating SESSION_SECRET)
//   npm run admin -- revoke-sessions --user <user-id>  sign one account out everywhere

const USAGE = "Usage: npm run admin -- revoke-sessions (--all | --user <user-id>)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command, flag, value] = process.argv.slice(2);
if (command !== "revoke-sessions" || (flag !== "--all" && flag !== "--user") || (flag === "--user" && !UUID.test(value ?? ""))) {
  console.error(USAGE);
  process.exit(2);
}

const config = loadDatabaseConfig();
if (!config) {
  console.error("DATABASE_URL is not set (see backend/.env.example).");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: config.url, max: 2 });
try {
  const count = flag === "--all" ? await revokeAllSessionsAdmin(pool) : await revokeUserSessionsAdmin(pool, value as string);
  console.log(`Revoked ${count} session(s).`);
} catch {
  console.error("Could not revoke sessions: is the database up and migrated?");
  process.exitCode = 1;
} finally {
  await pool.end();
}

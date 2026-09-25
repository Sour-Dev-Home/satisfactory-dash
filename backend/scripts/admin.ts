import "dotenv/config";
import pg from "pg";
import { loadDatabaseConfig } from "../src/platform/db/config.js";
import { ConfigError } from "../src/platform/errors.js";
import { loadSecretsKeyringFromEnv } from "../src/platform/secrets/secrets.js";
import { revokeAllSessionsAdmin, revokeUserSessionsAdmin } from "../src/modules/identity/sessionAdmin.js";
import { loadConfiguredServersFromFile, loadSatisfactoryServerConfigFromEnv } from "../src/modules/gameserver/index.js";
import { ImportError, importServers, listConnections, loadServerRegistryFromEnv, resolveAllowedAddress } from "../src/modules/servers/index.js";

// ADR-0025: break-glass commands, run locally against the app database (DATABASE_URL in
// backend/.env). Shell access to this PC is the trust boundary. Output never includes secrets.
//
//   npm run admin -- revoke-sessions --all             sign everyone out (replaces rotating SESSION_SECRET)
//   npm run admin -- revoke-sessions --user <user-id>  sign one account out everywhere
//   npm run admin -- import-servers                    ADR-0030: copy the configured servers (the servers file or
//                                                      the single-server env) into the database, tokens encrypted
//                                                      with SERVER_SECRETS_KEY. Idempotent; never overwrites.

//   npm run admin -- verify-secrets                    ADR-0030: open every stored token with SERVER_SECRETS_KEY and
//                                                      report how many open (never prints a token); used by the
//                                                      restore rehearsal. Exits 1 if any cannot be opened.

const USAGE = "Usage: npm run admin -- (revoke-sessions (--all | --user <user-id>) | import-servers | verify-secrets)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command, flag, value] = process.argv.slice(2);
const isRevoke =
  command === "revoke-sessions" && (flag === "--all" || (flag === "--user" && UUID.test(value ?? "")));
const isImport = command === "import-servers" && flag === undefined;
const isVerify = command === "verify-secrets" && flag === undefined;
if (!isRevoke && !isImport && !isVerify) {
  console.error(USAGE);
  process.exit(2);
}

const config = loadDatabaseConfig();
if (!config) {
  console.error("DATABASE_URL is not set (see backend/.env.example).");
  process.exit(1);
}

async function runImport(pool: pg.Pool): Promise<void> {
  let ring;
  let configured;
  try {
    ring = loadSecretsKeyringFromEnv();
    configured =
      loadConfiguredServersFromFile() ??
      (() => {
        const serverConfig = loadSatisfactoryServerConfigFromEnv();
        return loadServerRegistryFromEnv().map(({ id, displayName }) => ({ id, displayName, config: serverConfig }));
      })();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (ring === null) {
    console.error("SERVER_SECRETS_KEY is not set (openssl rand -base64 32); back it up offline before importing.");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await importServers(pool, ring, configured, (host) => resolveAllowedAddress(host));
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    console.log(`Imported ${result.imported.length} server(s): ${result.imported.join(", ") || "none"}.`);
    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} already in the database: ${result.skipped.join(", ")}.`);
    }
    console.log("Next: remove the server variables from backend/.env (or the servers file), then restart the backend.");
  } catch (err) {
    if (err instanceof ImportError) {
      console.error(`Nothing was imported: ${err.message}`);
    } else {
      console.error("Could not import servers: is the database up and migrated (npm run db:migrate -w backend)?");
    }
    process.exitCode = 1;
  }
}

async function runVerify(pool: pg.Pool): Promise<void> {
  let ring;
  try {
    ring = loadSecretsKeyringFromEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (ring === null) {
    console.error("SERVER_SECRETS_KEY is not set: put the backed-up key in the environment to verify it.");
    process.exitCode = 1;
    return;
  }
  try {
    const { connections, unreadable } = await listConnections(pool, ring);
    console.log(`${connections.length} stored connection(s) opened with the key; ${unreadable.length} could not be opened.`);
    for (const row of unreadable) console.log(`  cannot open: server "${row.publicId}" (key id "${row.keyId}")`);
    if (unreadable.length > 0 || connections.length === 0) {
      if (connections.length === 0 && unreadable.length === 0) console.log("There are no stored connections to check.");
      process.exitCode = 1;
    }
  } catch {
    console.error("Could not read the stored connections: is the database up and migrated?");
    process.exitCode = 1;
  }
}

const pool = new pg.Pool({ connectionString: config.url, max: 2 });
try {
  if (isImport) {
    await runImport(pool);
  } else if (isVerify) {
    await runVerify(pool);
  } else {
    try {
      const count = flag === "--all" ? await revokeAllSessionsAdmin(pool) : await revokeUserSessionsAdmin(pool, value as string);
      console.log(`Revoked ${count} session(s).`);
    } catch {
      console.error("Could not revoke sessions: is the database up and migrated?");
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}

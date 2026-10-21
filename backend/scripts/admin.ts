import "dotenv/config";
import { createInterface } from "node:readline";
import pg from "pg";
import { saveDiscordDestination } from "../src/modules/alerts/index.js";
import { loadDatabaseConfig } from "../src/platform/db/config.js";
import { ConfigError } from "../src/platform/errors.js";
import { loadSecretsKeyringFromEnv } from "../src/platform/secrets/secrets.js";
import { listServersAdmin, removeServerAdmin } from "../src/modules/servers/serverAdmin.js";
import { disableUserAdmin, enableUserAdmin } from "../src/modules/identity/accountAdmin.js";
import { createAccountDeletion } from "../src/modules/identity/accountDeletion.js";
import { createAccountServers } from "../src/modules/servers/index.js";
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

//   npm run admin -- set-alert-webhook <server-id>     ADR-0027: set a server's Discord webhook (until the rules API
//                                                      exists). The URL is read from STDIN, never from an argument
//                                                      (no shell history), validated against the Discord allowlist and
//                                                      stored encrypted. Prints only its last 4 characters.

//   npm run admin -- disable-user <user-id>            #516 abuse response: sets the account's status to disabled (sign-in
//                                                      refuses it) and ends all its sessions in one transaction.
//   npm run admin -- enable-user <user-id>             The second command: sets the account back to active.
//                                                      Both write an audit event (ids and counts, no personal data).
//                                                      disable-user also revokes the agent credentials of the servers
//                                                      the account owns (ADR-0046); the servers and their data stay.
//   npm run admin -- delete-user <user-id>             ADR-0047: deletes an account (an email request, a disabled account),
//                                                      the same deletion as DELETE /api/account without the fresh sign-in:
//                                                      its owned self-serve servers are removed, an owned operator server
//                                                      refuses it, the operator's own account is refused. Restart the
//                                                      backend after if servers were removed.
//   npm run admin -- remove-server <public-id>         The full delete of any server (the same transaction as the HTTP
//                                                      remove, which answers 404 to a non-member). Restart the backend after.
//   npm run admin -- list-servers                      Every live server: id, name, kind, created via, owner id, enrolled, last seen,
//                                                      history row counts. Ids and numbers only.

const USAGE =
  "Usage: npm run admin -- (revoke-sessions (--all | --user <user-id>) | disable-user <user-id> | enable-user <user-id> | delete-user <user-id> | remove-server <public-id> | list-servers | import-servers | verify-secrets | set-alert-webhook <server-id>)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command, flag, value] = process.argv.slice(2);
const isRevoke =
  command === "revoke-sessions" && (flag === "--all" || (flag === "--user" && UUID.test(value ?? "")));
const isImport = command === "import-servers" && flag === undefined;
const isVerify = command === "verify-secrets" && flag === undefined;
const isSetWebhook = command === "set-alert-webhook" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(flag ?? "") && value === undefined;
const isAccount = (command === "disable-user" || command === "enable-user") && UUID.test(flag ?? "") && value === undefined;
const PUBLIC_ID = /^[a-z0-9-]{1,32}$/;
const isRemoveServer = command === "remove-server" && PUBLIC_ID.test(flag ?? "") && value === undefined;
const isListServers = command === "list-servers" && flag === undefined;
const isDeleteUser = command === "delete-user" && UUID.test(flag ?? "") && value === undefined;
if (!isRevoke && !isImport && !isVerify && !isSetWebhook && !isAccount && !isRemoveServer && !isListServers && !isDeleteUser) {
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

async function readFirstLine(): Promise<string> {
  if (process.stdin.isTTY) console.error("Paste the Discord webhook URL, then press Enter:");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return "";
}

async function runSetWebhook(pool: pg.Pool, serverId: string): Promise<void> {
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
    console.error("SERVER_SECRETS_KEY is not set: the webhook is stored encrypted with it.");
    process.exitCode = 1;
    return;
  }
  const url = (await readFirstLine()).trim();
  try {
    const saved = await saveDiscordDestination(pool, ring, serverId, url);
    if (saved.ok) {
      console.log(`Saved the Discord webhook for "${serverId}" (ends in ${saved.last4}). Alerts are sent only when ALERT_DELIVERY=on.`);
    } else {
      // A stable code only: the input is never echoed.
      console.error(`Not saved: ${saved.code}. Expected https://discord.com/api/webhooks/<id>/<token> (or discordapp.com).`);
      process.exitCode = 1;
    }
  } catch {
    console.error("Could not save the webhook: is the database up and migrated (npm run db:migrate -w backend)?");
    process.exitCode = 1;
  }
}

async function runAccount(pool: pg.Pool, disable: boolean, userId: string): Promise<void> {
  try {
    const result = disable ? await disableUserAdmin(pool, userId) : await enableUserAdmin(pool, userId);
    if (!result.found) {
      console.error("No such account.");
      process.exitCode = 1;
    } else if (disable) {
      console.log(
        `Disabled the account, revoked ${result.sessionsRevoked} session(s) and ${result.agentsRevoked} agent credential(s) of the servers it owns. ` +
          "Re-enable: npm run admin -- enable-user <user-id> (the owner then enrols an agent again).",
      );
    } else {
      console.log("Re-enabled the account. It can sign in again; its old sessions stay revoked.");
    }
  } catch {
    console.error("Could not change the account: is the database up and migrated?");
    process.exitCode = 1;
  }
}

async function runRemoveServer(pool: pg.Pool, publicId: string): Promise<void> {
  try {
    if (await removeServerAdmin(pool, publicId)) {
      console.log(`Removed server "${publicId}" and everything stored for it. Restart the backend so it stops polling it.`);
    } else {
      console.error("No such server (or it is already removed).");
      process.exitCode = 1;
    }
  } catch {
    console.error("Could not remove the server: is the database up and migrated?");
    process.exitCode = 1;
  }
}

async function runDeleteUser(pool: pg.Pool, userId: string): Promise<void> {
  try {
    // No runtime here: this process cannot reach a running backend, so a removed server's entry goes at its restart.
    const result = await createAccountDeletion({ db: pool, servers: createAccountServers() }).deleteAccount({ userId });
    switch (result.outcome) {
      case "deleted":
        console.log(
          `Deleted the account: ${result.serversDeleted} owned self-serve server(s) removed, ${result.membershipsLeft} membership(s) and ` +
            `${result.pushSubscriptions} push subscription(s) gone with it. The audit rows naming its id are kept for their year.` +
            (result.serversDeleted > 0 ? " Restart the backend so it drops the removed servers." : ""),
        );
        break;
      case "not_found":
        console.error("No such account.");
        process.exitCode = 1;
        break;
      case "operator_account":
        console.error("That is the operator's own account: it is never deleted (the backend re-creates it at startup).");
        process.exitCode = 1;
        break;
      case "operator_servers":
        console.error(`Not deleted: the account owns operator-created server(s): ${result.servers.map((s) => s.id).join(", ")}. Remove them (remove-server) first.`);
        process.exitCode = 1;
        break;
      case "reauth_required":
        // Unreachable: the CLI passes no session. Kept so the switch is exhaustive.
        console.error("Not deleted.");
        process.exitCode = 1;
        break;
    }
  } catch {
    console.error("Could not delete the account: is the database up and migrated?");
    process.exitCode = 1;
  }
}

async function runListServers(pool: pg.Pool): Promise<void> {
  try {
    const rows = await listServersAdmin(pool);
    console.log(`${rows.length} server(s):`);
    for (const r of rows) {
      console.log(
        `  ${r.publicId}  "${r.displayName}"  kind=${r.kind}  via=${r.createdVia}  owner=${r.ownerUserId ?? "none"}  enrolled=${r.enrolled ? "yes" : "no"}  ` +
          `last_seen=${r.lastSeenAt ?? "never"}  power_rows=${r.powerRows}  item_rows=${r.itemRows}`,
      );
    }
  } catch {
    console.error("Could not list the servers: is the database up and migrated?");
    process.exitCode = 1;
  }
}

const pool = new pg.Pool({ connectionString: config.url, max: 2 });
try {
  if (isRemoveServer) {
    await runRemoveServer(pool, flag as string);
  } else if (isDeleteUser) {
    await runDeleteUser(pool, flag as string);
  } else if (isListServers) {
    await runListServers(pool);
  } else if (isAccount) {
    await runAccount(pool, command === "disable-user", flag as string);
  } else if (isSetWebhook) {
    await runSetWebhook(pool, flag as string);
  } else if (isImport) {
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

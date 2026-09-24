import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { resolveLogDir } from "./platform/logFiles.js";
import { ConfigError } from "./platform/errors.js";
import { createReadinessRouter, healthRouter } from "./platform/health.js";
import { Database, errorCode, loadDatabaseConfig } from "./platform/db/index.js";
import {
  createGameServerConnection,
  createServerOptionsPort,
  ignoredSingleServerEnvNames,
  loadConfiguredServersFromFile,
  loadSatisfactoryServerConfigFromEnv,
  parsePortEnv,
} from "./modules/gameserver/index.js";
import { createSettingsRouters, createSettingsServices } from "./modules/settings/index.js";
import {
  InMemoryServerDirectory,
  createDbServerAccess,
  createServersRouter,
  loadServerRegistryFromEnv,
  registerConfiguredServers,
} from "./modules/servers/index.js";
import { createTelemetryRouters, createTelemetryServices, createUnitResolver } from "./modules/telemetry/index.js";
import { createIdentityModule } from "./modules/identity/index.js";

// ADR-0013: the backend is reached only through the Cloudflare Tunnel on this machine,
// so it listens on loopback by default. Binding anywhere else (e.g. 0.0.0.0 in a
// container) needs an explicit HOST (go-live blocker, issue #19).
const host = process.env.HOST?.trim() || "127.0.0.1";
// LOG_DIR (game PC): daily log files kept 14 days instead of stdout. It is resolved before the
// logger exists, so a bad directory is reported on stderr and stops the backend.
let logDir: string | undefined;
try {
  logDir = resolveLogDir();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
const logger = createLogger({ logDir });

/** A ConfigError means the backend must not start (e.g. a public game-server host, or
 *  missing login settings, ADR-0011): log it and exit instead of crashing. */
function orExit<T>(load: () => T): T {
  try {
    return load();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      process.exit(1);
    }
    throw err;
  }
}

// A bad PORT used to become NaN (listen(NaN) picks a random port); now the backend refuses to start.
const port = orExit(() => parsePortEnv("PORT", process.env.PORT, 3001));

// A servers file replaces the single-server variables; naming any that are still set (names
// only, never values) keeps a half-migrated .env from being confusing.
const ignoredEnvNames = ignoredSingleServerEnvNames();
if (ignoredEnvNames.length > 0) {
  logger.warn(
    { ignored: ignoredEnvNames },
    "SATISFACTORY_SERVERS_FILE is set, so these single-server variables are ignored",
  );
}

// ADR-0015: one resolver for the whole process, so each unknown item (a modded item, or
// one newer than the committed catalog) is logged once, not once per request or server.
const resolveUnit = createUnitResolver((className) =>
  logger.warn({ className }, "item not in the item-form catalog; its unit is reported as unknown"),
);

// ADR-0001: one connection and one bundle of module services per registered game server.
// This file is the composition root (ADR-0014): the only place that knows every module.
const entries = orExit(() => {
  // ADR-0025 PR 1: SATISFACTORY_SERVERS_FILE names any number of servers, each with its own
  // connection config. Without it, single-server mode: a registry of one that uses the
  // SATISFACTORY_* env (unchanged, so the running deploy needs no new config).
  const configured =
    loadConfiguredServersFromFile() ??
    (() => {
      const config = loadSatisfactoryServerConfigFromEnv();
      return loadServerRegistryFromEnv().map(({ id, displayName }) => ({ id, displayName, config }));
    })();
  return configured.map(({ id, displayName, config }) => ({
    id,
    displayName,
    services: {
      telemetry: createTelemetryServices(createGameServerConnection(config), resolveUnit, {
        logger: logger.child({ worker: "power-history", serverId: id }),
      }),
      settings: createSettingsServices(createServerOptionsPort(config)),
    },
  }));
});
const directory = new InMemoryServerDirectory(entries);
// ADR-0022: the background workers (the power history poller per server). Started only once
// the server is listening, and stopped on shutdown.
const workers: { start(): void; stop(): Promise<void> }[] = entries.flatMap((entry) => entry.services.telemetry.workers);

// ADR-0025: the database is optional until deploy A. Without DATABASE_URL nothing changes (and
// /api/health/ready answers 200); with it, the process listens first, then connects in the
// background (retrying transient errors), and /api/health/ready reports 503 until it is up.
const databaseConfig = orExit(() => loadDatabaseConfig());
const database = databaseConfig ? new Database(databaseConfig, logger) : undefined;

// ADR-0011: every /api route except health and the auth endpoints needs a session.
// With a database, sessions live in it (ADR-0025 decision 4) and a purge worker keeps retention;
// without one, the original signed-token sessions still work.
const identity = orExit(() => createIdentityModule(process.env, { db: database?.pool, logger }));
workers.push(...identity.workers);

// ADR-0025 PR 6: with a database, every /api/servers/:serverId route needs a membership (a
// non-member gets the same 404 as an unknown server; a viewer's write is a 403) and the list is
// per user. The configured servers are registered, with the operator as owner, once the database
// is up; until then those routes answer 503. Without a database nothing changes.
let serversRegistered = database === undefined;
const serverAccess = database ? createDbServerAccess(database.pool) : undefined;

export const app = createApp({
  logger,
  allowedOrigins: identity.allowedOrigins,
  routers: [
    healthRouter,
    createReadinessRouter(async () => (database ? (await database.isReady()) && serversRegistered : true)),
    identity.authRouter,
  ],
  sessionGuard: identity.sessionGuard,
  protectedRouters: [
    createServersRouter(directory, serverAccess, { isReady: () => serversRegistered }),
    ...createTelemetryRouters(directory),
    ...createSettingsRouters(directory),
  ],
});

if (process.env.NODE_ENV !== "test") {
  const httpServer = app.listen(port, host, () => {
    logger.info({ host, port }, `backend listening on ${host}:${port}`);
    for (const worker of workers) {
      worker.start();
    }
    // ADR-0025 decision 6: a transient outage is retried with backoff (up to 5 minutes), then
    // (and for any setup error, e.g. a schema behind this build) the process exits 1, so the
    // Scheduled Task's restart-on-failure takes over and a broken setup still fails loudly.
    database
      ?.start()
      .then(async () => {
        const ownerId = await identity.ensureOperatorUserId?.();
        if (ownerId === undefined) {
          throw new Error("identity has no operator account in database mode");
        }
        const { registered } = await registerConfiguredServers(
          database.pool,
          entries.map(({ id, displayName }) => ({ id, displayName })),
          ownerId,
        );
        serversRegistered = true;
        logger.info({ registered }, "configured servers registered");
      })
      .catch((err: unknown) => {
        if (shuttingDown) {
          return; // a deliberate stop is exit 0, never a startup failure
        }
        if (err instanceof ConfigError) {
          logger.fatal(err.message);
        } else {
          logger.fatal({ code: errorCode(err) }, "database startup failed");
        }
        process.exit(1);
      });
  });

  // Graceful shutdown (Ctrl+C, or a container's SIGTERM): stop the workers, let in-flight
  // requests finish, then exit 0 (the Scheduled Task wrapper treats 0 as a deliberate stop).
  // A hard kill (Stop-ScheduledTask) skips this and is fine: nothing here needs flushing.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    // Workers get a short window to stop: their in-flight polls are bounded, but on exit their
    // results don't matter, so a hung game server must not turn a deliberate stop into a failure.
    const workersStopped = Promise.race([
      Promise.allSettled([...workers.map((worker) => worker.stop()), database?.close()]),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000).unref()),
    ]);
    // Stop accepting requests now. Idle keep-alive sockets close at once; a request that never
    // finishes is cut after a grace period, otherwise close() would never complete.
    httpServer.close(() => void workersStopped.then(() => process.exit(0)));
    httpServer.closeIdleConnections();
    setTimeout(() => httpServer.closeAllConnections(), 5_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

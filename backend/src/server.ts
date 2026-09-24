import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { ConfigError } from "./platform/errors.js";
import { createReadinessRouter, healthRouter } from "./platform/health.js";
import { Database, errorCode, loadDatabaseConfig } from "./platform/db/index.js";
import {
  createGameServerConnection,
  createServerOptionsPort,
  loadSatisfactoryServerConfigFromEnv,
  parsePortEnv,
} from "./modules/gameserver/index.js";
import { createSettingsRouters, createSettingsServices } from "./modules/settings/index.js";
import { InMemoryServerDirectory, createServersRouter, loadServerRegistryFromEnv } from "./modules/servers/index.js";
import { createTelemetryRouters, createTelemetryServices, createUnitResolver } from "./modules/telemetry/index.js";
import { createIdentityModule } from "./modules/identity/index.js";

// ADR-0013: the backend is reached only through the Cloudflare Tunnel on this machine,
// so it listens on loopback by default. Binding anywhere else (e.g. 0.0.0.0 in a
// container) needs an explicit HOST (go-live blocker, issue #19).
const host = process.env.HOST?.trim() || "127.0.0.1";
const logger = createLogger();

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

// ADR-0015: one resolver for the whole process, so each unknown item (a modded item, or
// one newer than the committed catalog) is logged once, not once per request or server.
const resolveUnit = createUnitResolver((className) =>
  logger.warn({ className }, "item not in the item-form catalog; its unit is reported as unknown"),
);

// ADR-0001: one connection and one bundle of module services per registered game server.
// This file is the composition root (ADR-0014): the only place that knows every module.
const entries = orExit(() => {
  const registry = loadServerRegistryFromEnv();
  // Single-server mode: every entry uses the one SATISFACTORY_* connection config.
  // Per-server connection config arrives with the multi-server registry (ADR-0001).
  const config = loadSatisfactoryServerConfigFromEnv();
  return registry.map(({ id, displayName }) => ({
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
const workers = entries.flatMap((entry) => entry.services.telemetry.workers);

// ADR-0025: the database is optional until deploy A. Without DATABASE_URL nothing changes (and
// /api/health/ready answers 200); with it, the process listens first, then connects in the
// background (retrying transient errors), and /api/health/ready reports 503 until it is up.
const databaseConfig = orExit(() => loadDatabaseConfig());
const database = databaseConfig ? new Database(databaseConfig, logger) : undefined;

// ADR-0011: every /api route except health and the auth endpoints needs a session.
const identity = orExit(() => createIdentityModule());

export const app = createApp({
  logger,
  allowedOrigins: identity.allowedOrigins,
  routers: [
    healthRouter,
    createReadinessRouter(() => (database ? database.isReady() : Promise.resolve(true))),
    identity.authRouter,
  ],
  sessionGuard: identity.sessionGuard,
  protectedRouters: [
    createServersRouter(directory),
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
    database?.start().catch((err: unknown) => {
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

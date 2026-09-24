import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { ConfigError } from "./platform/errors.js";
import { healthRouter } from "./platform/health.js";
import {
  createGameServerConnection,
  createServerOptionsPort,
  loadSatisfactoryServerConfigFromEnv,
} from "./modules/gameserver/index.js";
import { createSettingsRouters, createSettingsServices } from "./modules/settings/index.js";
import { InMemoryServerDirectory, createServersRouter, loadServerRegistryFromEnv } from "./modules/servers/index.js";
import { createTelemetryRouters, createTelemetryServices, createUnitResolver } from "./modules/telemetry/index.js";
import { createIdentityModule } from "./modules/identity/index.js";

const port = Number(process.env.PORT || 3001);
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

// ADR-0011: every /api route except health and the auth endpoints needs a session.
const identity = orExit(() => createIdentityModule());

export const app = createApp({
  logger,
  allowedOrigins: identity.allowedOrigins,
  routers: [healthRouter, identity.authRouter],
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
    void Promise.allSettled(workers.map((worker) => worker.stop())).then(() => {
      httpServer.close(() => process.exit(0));
      httpServer.closeIdleConnections();
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

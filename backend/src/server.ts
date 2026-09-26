import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { resolveLogDir } from "./platform/logFiles.js";
import { ConfigError } from "./platform/errors.js";
import { loadSecretsKeyringFromEnv } from "./platform/secrets/secrets.js";
import { createEventLoopMonitor, loadEventLoopStallMs } from "./platform/eventLoopMonitor.js";
import { createReadinessRouter, healthRouter } from "./platform/health.js";
import { recordUpstreamCall } from "./platform/requestTiming.js";
import { Database, errorCode, loadDatabaseConfig } from "./platform/db/index.js";
import {
  configuredServerEnvNamesInUse,
  createGameServerConnection,
  createSatisfactoryServerConfig,
  createServerOptionsPort,
  ignoredSingleServerEnvNames,
  loadConfiguredServersFromFile,
  loadSatisfactoryServerConfigFromEnv,
  nonLoopbackServerIds,
  parsePortEnv,
  testGameServerConnection,
} from "./modules/gameserver/index.js";
import type { SatisfactoryServerConfig } from "./modules/gameserver/index.js";
import { createSettingsRouters, createSettingsServices } from "./modules/settings/index.js";
import {
  ServerRuntime,
  findServerByPublicId,
  createDbServerAccess,
  createServerManagementRouters,
  createServerManagementService,
  createServersRouter,
  addressVerdict,
  loadDatabaseServers,
  loadServerRegistryFromEnv,
  registerConfiguredServers,
} from "./modules/servers/index.js";
import type { ServerConnection } from "./modules/servers/index.js";
import {
  createAlertDelivery,
  createAlertEvaluator,
  createAlertsRouters,
  createAlertsService,
  loadAlertDeliveryMode,
} from "./modules/alerts/index.js";
import {
  createAgentTelemetryServices,
  createHistoryMaintenance,
  createTelemetryRouters,
  createTelemetryServices,
  createUnitResolver,
} from "./modules/telemetry/index.js";
import {
  AGENT_CADENCE,
  CommandNotifier,
  createAgentApiRouters,
  createAgentSettingsServices,
  createAgentUserRouters,
  createAgentsService,
  createCommandSweeper,
  createCommandsService,
} from "./modules/agents/index.js";
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

// ADR-0025: the database is optional until deploy A. Without DATABASE_URL nothing changes (and
// /api/health/ready answers 200); with it, the process listens first, then connects in the
// background (retrying transient errors), and /api/health/ready reports 503 until it is up.
// Declared before buildServer: every server's history recorder writes through its pool (ADR-0027).
const databaseConfig = orExit(() => loadDatabaseConfig());
const database = databaseConfig ? new Database(databaseConfig, logger) : undefined;
// ADR-0031 PR 5b: commands to edge agents (auto-pause today). One notifier, so a command created by a dashboard request
// wakes the agent's long-poll; both faces of the service share it.
const agentCommands = database ? createCommandsService({ db: database.pool, notifier: new CommandNotifier() }) : undefined;

// ADR-0001: one connection and one bundle of module services per registered game server.
// This file is the composition root (ADR-0014): the only place that knows every module.
function buildServer(id: string, displayName: string, untimedConfig: SatisfactoryServerConfig) {
  // ADR-0032: every call to the game server reports how long it took, so a request's time splits into app and upstream.
  const config: SatisfactoryServerConfig = { ...untimedConfig, onUpstreamCall: recordUpstreamCall };
  const telemetry = createTelemetryServices(createGameServerConnection(config), resolveUnit, {
    logger: logger.child({ worker: "power-history", serverId: id }),
    // ADR-0027: history is written for every server, including ones added at runtime (they come through here).
    history: database ? { db: database.pool, serverPublicId: id } : undefined,
  });
  return {
    id,
    displayName,
    services: { telemetry, settings: createSettingsServices(createServerOptionsPort(config)) },
    workers: telemetry.workers,
  };
}

/** ADR-0031 PR 5a: a server reached through an edge agent. No game connection and no pollers: its live reads serve the
 *  agent's last snapshot and its history is fed by the snapshots. Only built with a database (an agent needs one). */
function buildAgentServer(id: string, displayName: string) {
  if (!database || !agentCommands) throw new Error("an agent server needs a database");
  const telemetry = createAgentTelemetryServices({
    logger: logger.child({ worker: "agent-history", serverId: id }),
    cadence: () => AGENT_CADENCE,
    history: { db: database.pool, serverPublicId: id },
  });
  return { id, displayName, services: { telemetry, settings: createAgentSettingsServices(agentCommands, id, telemetry.agentAutoPause) }, workers: telemetry.workers };
}

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
  // ADR-0030 amendment 1: servers configured in the environment are outside the LAN gate (they are the operator's own
  // configuration), but a LAN host has no certificate verification: say so once, by id, never naming the address.
  const lanServerIds = nonLoopbackServerIds(configured);
  if (lanServerIds.length > 0) {
    logger.warn(
      { servers: lanServerIds },
      "an environment-configured server is not on loopback: its API certificate is unverified on the LAN (ADR-0030 amendment 1)",
    );
  }
  return configured.map(({ id, displayName, config }) => buildServer(id, displayName, config));
});
// ADR-0030: the servers this process serves. Built from the config now; with a database, the servers
// stored in it replace these once it is up (see loadDatabaseServers). The runtime starts and stops each
// server's pollers (ADR-0022), also for servers added or removed while the backend runs.
const directory = new ServerRuntime(entries, {
  onWorkerStartError: (serverId, err) =>
    logger.error({ serverId, error: err instanceof Error ? err.name : "unknown" }, "a server's background worker failed to start"),
  onWorkerStopError: (serverId, err) =>
    logger.warn({ serverId, error: err instanceof Error ? err.name : "unknown" }, "a server's background worker failed to stop"),
});
// Process-wide workers. Started once the server is listening, and stopped on shutdown.
const workers: { start(): void; stop(): Promise<void> }[] = [];
// Diagnostic: measures event loop delay and warns (numbers only) when a 30 s window's worst delay
// exceeds EVENT_LOOP_STALL_MS, to tell a machine-wide stall from our own loop being blocked.
workers.push(createEventLoopMonitor({ logger, thresholdMs: orExit(() => loadEventLoopStallMs()) }));

// ADR-0030: the key that encrypts stored game-server tokens. Unset is fine while no server is stored in
// the database; a set-but-malformed key stops the backend here rather than at the first use.
const secretsKeyring = orExit(() => loadSecretsKeyringFromEnv());

// ADR-0011: every /api route except health and the auth endpoints needs a session.
// With a database, sessions live in it (ADR-0025 decision 4) and a purge worker keeps retention;
// without one, the original signed-token sessions still work.
const identity = orExit(() => createIdentityModule(process.env, { db: database?.pool, logger }));
// ADR-0027 decision 5: the alert delivery kill switch, default OFF. A value that is not on/off stops the backend here.
// Delivery needs a database (the outbox) and the secrets key (the webhooks are stored encrypted): without either it
// cannot be on, and that is a startup error rather than a silent "off".
const alertDelivery = orExit(() => {
  const mode = loadAlertDeliveryMode();
  if (mode === "on" && (database === undefined || secretsKeyring === null)) {
    throw new ConfigError("ALERT_DELIVERY=on needs DATABASE_URL and SERVER_SECRETS_KEY (webhooks are stored encrypted).");
  }
  return mode;
});
logger.info({ alertDelivery }, alertDelivery === "on" ? "alert delivery is ON: new alert events are sent to Discord" : "alert delivery is OFF: alert events are recorded but nothing is sent");
// The identity module's workers need the database: they are started only AFTER the database startup
// check has succeeded (plus their own delay), not at boot, so their first run does not race the slow first
// connections of a new process (issue #153). They are stopped with the others.
// ADR-0027: the history rollup and retention worker joins them, for the same reason (it needs the database up).
const databaseWorkers = [
  ...identity.workers,
  ...(database ? [createHistoryMaintenance(database.pool, logger.child({ worker: "history-maintenance" }))] : []),
  // ADR-0031 PR 5b: expires agent commands that ran out and purges old finished ones.
  ...(database ? [createCommandSweeper(database.pool, logger.child({ worker: "agent-commands" }))] : []),
  // ADR-0027 PR 5: the alert engine evaluates every server's rules from the pollers' last readings and records the
  // transitions in the alert log. It needs the database up, so it starts with the others. PR 6: with ALERT_DELIVERY
  // on it also queues each new event for the server's destinations, and the sender delivers them; off (the default)
  // it queues nothing and sends nothing.
  ...(database ? [createAlertEvaluator(database.pool, directory, logger.child({ worker: "alerts" }), { deliver: alertDelivery === "on" })] : []),
  ...(database && alertDelivery === "on" && secretsKeyring
    ? [createAlertDelivery(database.pool, secretsKeyring, logger.child({ worker: "alert-delivery" }))]
    : []),
];

// ADR-0025 PR 6: with a database, every /api/servers/:serverId route needs a membership (a
// non-member gets the same 404 as an unknown server; a viewer's write is a 403) and the list is
// per user. The configured servers are registered, with the operator as owner, once the database
// is up; until then those routes answer 503. Without a database nothing changes.
let serversRegistered = database === undefined;
// ADR-0030: the seeded operator account, known once the database is up. Only this account may manage servers.
let operatorUserId: string | undefined;

/** A stored connection becomes a running server that connects to its PINNED address. The address is
 *  re-checked here as well (defence in depth): nothing but a loopback or private address is ever built. */
function buildFromConnection(c: ServerConnection) {
  if (addressVerdict(c.pinnedIp) !== "ok") {
    throw new Error("refusing to build a server whose address is not usable (not loopback while LAN servers wait for certificate pinning)");
  }
  return buildServer(
    c.publicId,
    c.displayName,
    createSatisfactoryServerConfig({ host: c.pinnedIp, apiPort: c.apiPort, apiToken: c.apiToken, frmPort: c.frmPort, frmToken: c.frmToken }),
  );
}

const serverManagement = database
  ? createServerManagementService({
      db: database.pool,
      ring: secretsKeyring,
      runtime: directory,
      build: buildFromConnection,
      testConnection: ({ pinnedIp, apiPort, frmPort, apiToken, frmToken }) =>
        testGameServerConnection(createSatisfactoryServerConfig({ host: pinnedIp, apiPort, apiToken, frmPort, frmToken })),
      getOperatorUserId: () => operatorUserId,
      configuredServerEnvNames: () => configuredServerEnvNamesInUse(),
    })
  : undefined;
const managementRouters = serverManagement
  ? createServerManagementRouters(serverManagement, { isReady: () => serversRegistered })
  : undefined;
// ADR-0030: false when a stored connection cannot be opened (no key, an unknown key id, a modified
// value). The backend stays up and serves the readable servers, but reports not-ready.
let connectionsReadable = true;
const serverAccess = database ? createDbServerAccess(database.pool) : undefined;

// ADR-0031 PR 5a: makes sure a server has its agent-backed running entry. Called after an enrolment commits (the server
// was a local one: its entry, with its pollers, is replaced and the pollers stop) and by the first snapshot of a server
// that has none. Idempotent, and one swap at a time per server so two callers cannot build two entries.
const attaching = new Map<string, Promise<void>>();
function attachAgentRuntime(publicId: string): Promise<void> {
  if (!database || directory.get(publicId)?.telemetry.agentIngest !== undefined) {
    return Promise.resolve();
  }
  const running = attaching.get(publicId);
  if (running) {
    return running;
  }
  const swap = (async () => {
    const displayName =
      directory.list().find((server) => server.id === publicId)?.displayName ?? (await findServerByPublicId(database.pool, publicId))?.displayName;
    if (displayName === undefined) {
      return; // the server was removed: nothing to attach
    }
    await directory.replace(buildAgentServer(publicId, displayName));
  })().finally(() => attaching.delete(publicId));
  attaching.set(publicId, swap);
  return swap;
}

export const app = createApp({
  logger,
  allowedOrigins: identity.allowedOrigins,
  routers: [
    healthRouter,
    createReadinessRouter(async () => (database ? (await database.isReady()) && serversRegistered && connectionsReadable : true)),
    identity.authRouter,
  ],
  sessionGuard: identity.sessionGuard,
  protectedRouters: [
    // The collection routes must come before the servers router (its /servers/:serverId check would
    // read "test-connection" as a server id); the scoped ones after it (its membership check runs first).
    ...(managementRouters ? [managementRouters.collection] : []),
    createServersRouter(directory, serverAccess, {
      isReady: () => serversRegistered,
      canManage: serverManagement?.canManage,
    }),
    ...createTelemetryRouters(directory),
    ...createSettingsRouters(directory),
    // ADR-0027 PR 7b: the alerts API. After the servers router (its membership check covers these paths), and only with a
    // database (alerts live in it).
    ...(database
      ? createAlertsRouters(
          createAlertsService({
            db: database.pool,
            ring: secretsKeyring,
            mode: alertDelivery,
            serverName: (id) => directory.list().find((server) => server.id === id)?.displayName,
          }),
        )
      : []),
    // ADR-0031 PR 5a: the owner's side of the edge agent (enrolment code, agent status, revoke), after the servers router.
    ...(database && agentCommands
      ? createAgentUserRouters(createAgentsService({ db: database.pool, canManage: (userId) => serverManagement?.canManage(userId) ?? false }), agentCommands)
      : []),
    ...(managementRouters ? [managementRouters.scoped] : []),
  ],
  // ADR-0031 PR 5a: the agent's own API at /agent/v1, outside /api: its own credential, no session.
  agentRouters: database && agentCommands
    ? createAgentApiRouters({ db: database.pool, logger: logger.child({ module: "agents" }), commands: agentCommands, directory, attachAgentRuntime, isReady: () => serversRegistered })
    : [],
});

if (process.env.NODE_ENV !== "test") {
  const httpServer = app.listen(port, host, () => {
    logger.info({ host, port }, `backend listening on ${host}:${port}`);
    for (const worker of workers) {
      worker.start();
    }
    directory.start();
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
        operatorUserId = ownerId;
        // ADR-0030 precedence: servers stored in the database win over the config. With none stored,
        // the configured servers are registered exactly as before.
        const stored = await loadDatabaseServers({
          db: database.pool,
          ring: secretsKeyring,
          runtime: directory,
          operatorUserId: ownerId,
          build: buildFromConnection,
          buildAgent: ({ publicId, displayName }) => buildAgentServer(publicId, displayName),
        });
        if (stored.usingDatabase) {
          const ignored = configuredServerEnvNamesInUse();
          if (ignored.length > 0) {
            logger.warn({ ignored }, "servers are stored in the database, so these server variables are ignored; remove them");
          }
          logger.info({ servers: stored.loaded }, "servers loaded from the database");
          if (stored.unreadable.length > 0) {
            connectionsReadable = false;
            logger.error(
              { code: "SERVER_CONNECTIONS_UNREADABLE", servers: stored.unreadable.map(({ publicId, keyId }) => ({ publicId, keyId })) },
              "stored server connections cannot be opened (missing or wrong SERVER_SECRETS_KEY, or a modified value); they are not served",
            );
          }
          if (stored.refused.length > 0) {
            connectionsReadable = false;
            logger.error(
              { code: "SERVER_CONNECTIONS_REFUSED", servers: stored.refused.map(({ publicId }) => ({ publicId })) },
              "stored server connections have an address that is not usable (not loopback: LAN servers wait for certificate pinning); they are not served",
            );
          }
          serversRegistered = true;
        } else {
          const { registered } = await registerConfiguredServers(
            database.pool,
            entries.map(({ id, displayName }) => ({ id, displayName })),
            ownerId,
          );
          serversRegistered = true;
          logger.info({ registered }, "configured servers registered");
        }
        if (!shuttingDown) {
          for (const worker of databaseWorkers) {
            worker.start();
          }
        }
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
    // The pool closes only AFTER the workers have stopped: the history recorders make one last write on stop (ADR-0027),
    // and a pool closed underneath them would lose those rows.
    const workersStopped = Promise.race([
      Promise.allSettled([...[...workers, ...databaseWorkers].map((worker) => worker.stop()), directory.stop()]).then(() =>
        Promise.allSettled([database?.close()]),
      ),
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

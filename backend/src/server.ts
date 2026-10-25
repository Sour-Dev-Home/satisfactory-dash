import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { installFatalHandlers } from "./platform/fatalHandlers.js";
import { resolveLogDir } from "./platform/logFiles.js";
import { ConfigError } from "./platform/errors.js";
import { loadSecretsKeyringFromEnv } from "./platform/secrets/secrets.js";
import { bootSequence } from "./platform/bootSequence.js";
import { Mutex } from "./platform/mutex.js";
import { environmentServerEntries, warnEnvServersNotServed } from "./platform/envServers.js";
import { createEventLoopMonitor, loadEventLoopStallMs } from "./platform/eventLoopMonitor.js";
import { createReadinessRouter, healthRouter } from "./platform/health.js";
import { recordUpstreamCall } from "./platform/requestTiming.js";
import { createMetricsAggregator, createSeriesFlushWorker } from "./platform/metrics/index.js";
import { buildCommit } from "./platform/buildInfo.js";
import { writeRunFile } from "./platform/runFile.js";
import { formatErrorDetail } from "./platform/formatErrorDetail.js";
import { Database, LeaderLock, createLeaderLockClient, databasePortOf, errorCode, loadDatabaseConfig } from "./platform/db/index.js";
import { LeaderWorkerGroup } from "./platform/leaderWorkers.js";
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
  createSelfServeRouter,
  createSelfServeService,
  createPendingServerSweeper,
  addUnlessRemoved,
  createServersRouter,
  createAccountServers,
  createDbMemberSelfService,
  createMembersRouter,
  addressVerdict,
  loadSelfServeConfigFromEnv,
  loadDatabaseServers,
  loadServerRegistryFromEnv,
} from "./modules/servers/index.js";
import type { ServerConnection } from "./modules/servers/index.js";
import {
  createAlertDelivery,
  createAlertEvaluator,
  createAlertsRouters,
  createAlertsService,
  createPushRouters,
  createPushService,
  loadAlertDeliveryMode,
  loadPushConfig,
  pushEnabled,
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
  createAgentAuth,
  createAgentSettingsServices,
  releaseAgentServer,
  enrolledServerIds,
  createAgentUserRouters,
  createAgentsService,
  createCommandSweeper,
  createCommandsService,
  loadEnrollmentCodesPerHour,
} from "./modules/agents/index.js";
import { createAccountDeletion, createAccountRouter, createIdentityModule } from "./modules/identity/index.js";
import { createMetricsRouter, createMetricsService } from "./modules/metrics/index.js";
import { MapLiveStore, LocalWorldPoller, WorldIngestService, createAgentWorldRouter, createWorldRoutes } from "./modules/map/index.js";

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
// #560: a crash is one JSON fatal line (the CloudWatch filters match it), then exit 1. Not under Vitest, which owns
// those events in its workers (the handlers have their own tests).
if (process.env.NODE_ENV !== "test") {
  installFatalHandlers({ logger, exit: (code) => process.exit(code), target: process });
}

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
// ADR-0046 C7 (#527): a bad value stops the backend at startup, like PORT.
const enrollmentCodesPerHour = orExit(() => loadEnrollmentCodesPerHour(process.env));

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
// ADR-0038 M3 (#353): mapLive (trains, stations) is read-through only, one process-wide store keyed
// by server public id (map/services/mapLiveStore.ts); world layers (rails, resourceNodes) need the
// database, so ingest is undefined without one, same as the other database-gated services below.
const mapLiveStore = new MapLiveStore();
const worldIngest = database ? new WorldIngestService(database.pool, logger.child({ module: "map" })) : undefined;

// ADR-0001: one connection and one bundle of module services per registered game server.
// This file is the composition root (ADR-0014): the only place that knows every module.
function buildServer(id: string, displayName: string, untimedConfig: SatisfactoryServerConfig) {
  // ADR-0054 D3: its pollers run only on the leader, and are one-shot: stepping down swaps in a fresh build (ServerRuntime).
  return { ...buildPolledServer(id, displayName, untimedConfig), rebuild: (name: string) => buildPolledServer(id, name, untimedConfig) };
}

function buildPolledServer(id: string, displayName: string, untimedConfig: SatisfactoryServerConfig) {
  // ADR-0032: every call to the game server reports how long it took, so a request's time splits into app and upstream.
  const config: SatisfactoryServerConfig = { ...untimedConfig, onUpstreamCall: recordUpstreamCall };
  const connection = createGameServerConnection(config);
  const telemetry = createTelemetryServices(connection, resolveUnit, {
    logger: logger.child({ worker: "power-history", serverId: id }),
    // ADR-0027: history is written for every server, including ones added at runtime (they come through here).
    history: database ? { db: database.pool, serverPublicId: id } : undefined,
  });
  // ADR-0038 M3: a LOCAL server has no edge agent, so the backend reads its own world layers and
  // mapLive directly (`connection` satisfies LocalWorldPollerPorts structurally: getRails,
  // getResourceNodes, getTrains, getTrainStations). Needs the database (world layers are stored).
  const mapPoller = worldIngest
    ? new LocalWorldPoller(connection, {
        logger: logger.child({ worker: "map-world", serverId: id }),
        serverPublicId: id,
        ingest: worldIngest,
        mapLive: mapLiveStore.sinkFor(id),
      })
    : undefined;
  return {
    id,
    displayName,
    services: { telemetry, settings: createSettingsServices(createServerOptionsPort(config)) },
    workers: mapPoller ? [...telemetry.workers, mapPoller] : telemetry.workers,
  };
}

/** ADR-0031 PR 5a: a server reached through an edge agent. No game connection and no pollers: its live reads serve the
 *  agent's last snapshot and its history is fed by the snapshots. Only built with a database (an agent needs one). */
function buildAgentServer(id: string, displayName: string) {
  if (!database || !agentCommands) throw new Error("an agent server needs a database");
  const telemetry = createAgentTelemetryServices({
    logger: logger.child({ worker: "agent-history", serverId: id }),
    cadence: () => AGENT_CADENCE,
    resolveUnit, // ADR-0031: the agent sends rates without a unit; ingest resolves it from the same catalog as a polled server
    history: { db: database.pool, serverPublicId: id },
    // ADR-0038 M3: an agent-backed server's mapLive arrives through its snapshot (M4), not a poller.
    mapLive: mapLiveStore.sinkFor(id),
  });
  return { id, displayName, services: { telemetry, settings: createAgentSettingsServices(agentCommands, id, telemetry.agentAutoPause) }, workers: telemetry.workers, kind: "agent" as const };
}

// Issue #196 (architect, option A): with a database the servers come ONLY from it, so nothing is built from the environment
// (no placeholder runtime whose pollers could fire without credentials); without one the environment's servers are the servers.
const entries = environmentServerEntries(database !== undefined, () => orExit(() => {
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
}));
// ADR-0030: the servers this process serves. Built from the config now; with a database, the servers
// stored in it replace these once it is up (see loadDatabaseServers). The runtime starts and stops each
// server's pollers (ADR-0022), also for servers added or removed while the backend runs.
const directory = new ServerRuntime(entries, {
  onWorkerStartError: (serverId, err) =>
    logger.error({ serverId, error: err instanceof Error ? err.name : "unknown" }, "a server's background worker failed to start"),
  onWorkerStopError: (serverId, err) =>
    logger.warn({ serverId, error: err instanceof Error ? err.name : "unknown" }, "a server's background worker failed to stop"),
  // #516: a removed server's live map reading must not be served to a server re-created under the same id.
  onRemoved: (serverId) => mapLiveStore.forget(serverId),
  // ADR-0054 D3: with a database, a polled server's pollers run only on the leader instance (an agent server's workers run
  // everywhere: they only hold what reached this instance). Without one this process is always the leader.
  leaderGated: database !== undefined,
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
// ADR-0044: web push. VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are all set or all unset (anything else stops
// the backend here, naming the variable). Push is enabled only with ALERT_DELIVERY=on, VAPID configured and a database
// (the routes are mounted only with one). Only the on/off state is logged, never a key.
const pushConfig = orExit(() => loadPushConfig());
logger.info({ pushConfigured: pushConfig.vapid !== null }, "web push VAPID keys " + (pushConfig.vapid !== null ? "configured" : "not configured"));
// The identity module's workers need the database: they are started only AFTER the database startup
// check has succeeded (plus their own delay), not at boot, so their first run does not race the slow first
// connections of a new process (issue #153). They are stopped with the others.
// ADR-0027: the history rollup and retention worker joins them, for the same reason (it needs the database up).
// ADR-0037 PR 2: one instance, shared between the request middleware (records into it) and the flush
// worker below (drains it into Postgres every 60 s). Created unconditionally: without a database it
// still exists so the middleware has something to record into, just nothing ever flushes it.
const metricsAggregator = createMetricsAggregator();
// ADR-0054 D3: workers that are timer-driven and global run on the leader only (two copies would double alerts, Discord
// sends and purges). They are factories: most workers are one-shot, so each leadership term builds fresh ones.
type LeaderWorkerFactory = () => { start(): void; stop(): Promise<void> };
const leaderWorkerFactories: LeaderWorkerFactory[] = [
  // The session purge worker is restartable (stop clears its timers), so the same instance serves every term.
  ...identity.workers.map((worker) => () => worker),
  ...(database ? [() => createHistoryMaintenance(database.pool, logger.child({ worker: "history-maintenance" }))] : []),
  // ADR-0031 PR 5b: expires agent commands that ran out and purges old finished ones.
  ...(database ? [() => createCommandSweeper(database.pool, logger.child({ worker: "agent-commands" }))] : []),
  // ADR-0027 PR 5: the alert engine evaluates every server's rules from the pollers' last readings and records the
  // transitions in the alert log. PR 6: with ALERT_DELIVERY on it also queues each new event for the server's
  // destinations, and the sender delivers them; off (the default) it queues nothing and sends nothing.
  // ADR-0044 (348-2): with push enabled too (VAPID configured), each new event is also queued for the subscriptions of
  // the server's opted-in, active members, and the same sender delivers them.
  // ADR-0054 D3.4: built on becoming leader, so its agent-silence clock starts then (the restart grace).
  ...(database
    ? [
        () =>
          createAlertEvaluator(database.pool, directory, logger.child({ worker: "alerts" }), {
            deliver: alertDelivery === "on",
            deliverPush: pushEnabled(alertDelivery, pushConfig, secretsKeyring),
          }),
      ]
    : []),
  ...(database && alertDelivery === "on" && secretsKeyring
    ? [() => createAlertDelivery(database.pool, secretsKeyring, logger.child({ worker: "alert-delivery" }), { push: pushConfig })]
    : []),
];
// The database workers start once the database is up and the servers are loaded (bootSequence). Metrics flush runs on
// every instance (each drains only its own counters, and the writes are additive); the leader lock starts the rest when
// this instance becomes the leader. #526's pending-server sweeper joins the leader factories below.
const leaderWorkers = new LeaderWorkerGroup(leaderWorkerFactories, logger.child({ worker: "leader" }));
const databaseWorkers = [
  ...(database ? [createSeriesFlushWorker(database.pool, metricsAggregator, logger.child({ worker: "metrics-flush" }))] : []),
  ...(database && databaseConfig
    ? [
        new LeaderLock({
          createClient: () => createLeaderLockClient(databaseConfig),
          logger: logger.child({ worker: "leader-lock" }),
          onAcquired: async () => {
            await directory.setLeader(true);
            leaderWorkers.start();
          },
          onLost: async () => {
            await leaderWorkers.stop();
            await directory.setLeader(false);
          },
        }),
      ]
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

const databasePort = databasePortOf(databaseConfig?.url);
// #526 (L1): one mutex for every runtime change that follows a server write (the operator's management service, the
// self-serve owner's rename and remove, the pending sweep), so their post-commit runtime changes run one at a time.
const serverWriteMutex = new Mutex();
const serverManagement = database
  ? createServerManagementService({
      db: database.pool,
      mutex: serverWriteMutex,
      ring: secretsKeyring,
      runtime: directory,
      build: buildFromConnection,
      testConnection: ({ pinnedIp, apiPort, frmPort, apiToken, frmToken }) =>
        testGameServerConnection(createSatisfactoryServerConfig({ host: pinnedIp, apiPort, apiToken, frmPort, frmToken })),
      getOperatorUserId: () => operatorUserId,
      configuredServerEnvNames: () => configuredServerEnvNamesInUse(),
      // Issue #195: a loopback "game server" may not be this backend or its database.
      forbiddenPorts: databasePort === undefined ? [port] : [port, databasePort],
      // ADR-0031 amendment: what the agent side lets go of when a server is switched back to local (in the same transaction).
      releaseAgent: releaseAgentServer,
    })
  : undefined;
// ADR-0046: self-serve agent servers, shipped dark. SELF_SERVE_ENABLED (default false) and the caps are validated here; a bad
// value stops the backend, and turning it on needs a database (the servers and their owners live in it).
const selfServeConfig = orExit(() => {
  const config = loadSelfServeConfigFromEnv(process.env);
  if (config.enabled && database === undefined) throw new ConfigError("SELF_SERVE_ENABLED=true needs DATABASE_URL.");
  return config;
});
logger.info({ selfServe: selfServeConfig.enabled }, selfServeConfig.enabled ? "self-serve server creation is ON" : "self-serve server creation is OFF");
const selfServeService = database
  ? createSelfServeService({
      db: database.pool,
      config: selfServeConfig,
      isOperator: (userId) => operatorUserId !== undefined && operatorUserId === userId,
      enrolledServerIds,
      // The same builder enrolment uses: the new server gets its agent-backed runtime entry.
      attachRuntime: (publicId) => attachAgentRuntime(publicId),
      onAttachError: (serverId, err) =>
        logger.warn({ serverId, error: err instanceof Error ? err.name : "unknown" }, "a new self-serve server's runtime entry could not be built; its first snapshot attaches it"),
      // #526: an owner's rename and remove update the running servers after their commit.
      runtime: directory,
      mutex: serverWriteMutex,
    })
  : undefined;
const selfServeRouter = selfServeService
  ? createSelfServeRouter(selfServeService, { config: selfServeConfig, isReady: () => serversRegistered })
  : undefined;
// #526 (ADR-0046 section 1.8): the self-serve owner may also rename and remove their server (the contract's `selfServeOwner`).
const managementRouters = serverManagement
  ? createServerManagementRouters(serverManagement, { isReady: () => serversRegistered, selfServeOwner: selfServeService })
  : undefined;
// #526 (ADR-0046 C4): self-serve servers that never enrolled within SELF_SERVE_PENDING_TTL_HOURS are removed. Runs whatever
// SELF_SERVE_ENABLED says (turning creation off must not strand pending servers), started with the other database workers.
if (database) {
  leaderWorkerFactories.push(() =>
    createPendingServerSweeper({
      db: database.pool,
      logger: logger.child({ worker: "pending-servers" }),
      ttlHours: selfServeConfig.pendingTtlHours,
      enrolledServerIds,
      removeRuntime: (publicId) => directory.remove(publicId),
      mutex: serverWriteMutex,
    }),
  );
}
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
    // #526 (L2): a removal (owner, sweep, operator) may commit while this runs; re-checked after the swap.
    await addUnlessRemoved({
      publicId,
      runtime: directory,
      add: () => directory.replace(buildAgentServer(publicId, displayName)),
      isLive: async (id) => (await findServerByPublicId(database.pool, id)) !== undefined,
    });
  })().finally(() => attaching.delete(publicId));
  attaching.set(publicId, swap);
  return swap;
}

// #562: ONE agent-auth instance for the agent API and the world-layer routes, so they share the failure budgets, the
// recently-valid list and the per-credential lookup budget (map has no edge to agents, so it is injected).
const agentAuth = database ? createAgentAuth({ db: database.pool }) : undefined;

export const app = createApp({
  logger,
  allowedOrigins: identity.allowedOrigins,
  metricsAggregator,
  routers: [
    healthRouter,
    createReadinessRouter(async () => (database ? (await database.isReady()) && serversRegistered && connectionsReadable : true)),
    identity.authRouter,
  ],
  sessionGuard: identity.sessionGuard,
  protectedRouters: [
    // ADR-0047: DELETE /api/account, database only. Identity orchestrates; the servers' part is its port, implemented by the
    // servers module and given the shared server-write mutex and the running servers here (no module edge).
    ...(database
      ? [
          createAccountRouter(
            createAccountDeletion({ db: database.pool, servers: createAccountServers({ runtime: directory, mutex: serverWriteMutex }) }),
          ),
        ]
      : []),
    // The collection routes must come before the servers router (its /servers/:serverId check would
    // read "test-connection" as a server id); the scoped ones after it (its membership check runs first).
    ...(managementRouters ? [managementRouters.collection] : []),
    // ADR-0046: POST /api/servers/agent, a collection route too ("agent" is a reserved server id).
    ...(selfServeRouter ? [selfServeRouter] : []),
    createServersRouter(directory, serverAccess, {
      isReady: () => serversRegistered,
      canManage: serverManagement?.canManage,
      selfServeEnabled: selfServeConfig.enabled,
      ...(database && { enrolledServerIds: (serverUuids: readonly string[]) => enrolledServerIds(database.pool, serverUuids) }),
    }),
    // ADR-0047: leaving a server, after the servers router (its membership check lets any member make this write).
    ...(database ? [createMembersRouter(createDbMemberSelfService(database.pool))] : []),
    // ADR-0038 M3 (#353): after the servers router, same as every other /servers/:serverId route.
    createWorldRoutes(directory, database ? { db: database.pool, mapLive: mapLiveStore } : undefined),
    ...createTelemetryRouters(directory, database ? { db: database.pool } : undefined),
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
    // ADR-0056 PR 3: GET /api/admin/metrics, operator only (the same gate as the server management routes); database only.
    ...(database
      ? [
          createMetricsRouter(createMetricsService({ db: database.pool }), {
            isOperator: (userId) => operatorUserId !== undefined && operatorUserId === userId,
            isReady: () => serversRegistered,
          }),
        ]
      : []),
    // ADR-0044: web push (config, subscriptions, the per-server opt-in), after the servers router; database only.
    ...(database
      ? createPushRouters(createPushService({ db: database.pool, ring: secretsKeyring, mode: alertDelivery, config: pushConfig }))
      : []),
    // ADR-0031 PR 5a: the owner's side of the edge agent (enrolment code, agent status, revoke), after the servers router.
    ...(database && agentCommands
      ? createAgentUserRouters(createAgentsService({
            db: database.pool,
            canManage: (userId) => serverManagement?.canManage(userId) ?? false,
            codesPerHour: enrollmentCodesPerHour,
            // In memory, from the last snapshot the ingest recorded: fresher than last_seen_at (written at most every 30 s).
            lastHeardAt: (serverId) => directory.get(serverId)?.telemetry.observations?.snapshot().agent?.lastHeardAt,
          }), agentCommands)
      : []),
    ...(managementRouters ? [managementRouters.scoped] : []),
  ],
  // ADR-0031 PR 5a: the agent's own API at /agent/v1, outside /api: its own credential, no session.
  agentRouters: [
    ...(database && agentCommands && agentAuth
      ? createAgentApiRouters({ db: database.pool, logger: logger.child({ module: "agents" }), commands: agentCommands, directory, attachAgentRuntime, isReady: () => serversRegistered, auth: agentAuth })
      : []),
    // ADR-0038 M3 (#353): the world layers, behind the same agentAuth as the agent API (#562).
    ...(agentAuth && worldIngest ? [createAgentWorldRouter({ auth: agentAuth, ingest: worldIngest })] : []),
  ],
});

if (process.env.NODE_ENV !== "test") {
  const httpServer = app.listen(port, host, () => {
    logger.info({ host, port }, `backend listening on ${host}:${port}`);
    logger.info({ commit: buildCommit }, "backend started");
    // Issue #320, option C: a purely local proof of which build is serving, for deploy-update.ps1's
    // post-readiness check. Never blocks startup on a failure to write it (a bad RUN_FILE_DIR is an
    // ops problem, not a reason to refuse traffic); logged once if it happens.
    writeRunFile(process.env.RUN_FILE_DIR, { commit: buildCommit, pid: process.pid, startedAt: new Date().toISOString() }).catch(
      (err: unknown) => logger.warn({ err: formatErrorDetail(err) }, "failed to write the run file"),
    );
    // Issue #239: with a database the servers' pollers start only AFTER the stored servers are loaded (platform/bootSequence.ts),
    // so none of them fires against the placeholder runtime built from the environment (no credentials, one history gap).
    // ADR-0025 decision 6: a transient outage is retried with backoff (up to 5 minutes), then
    // (and for any setup error, e.g. a schema behind this build) the process exits 1, so the
    // Scheduled Task's restart-on-failure takes over and a broken setup still fails loudly.
    bootSequence({
      processWorkers: workers,
      runtime: directory,
      database,
      databaseWorkers,
      isShuttingDown: () => shuttingDown,
      onStartupFailure: (err) => {
        if (err instanceof ConfigError) {
          logger.fatal(err.message);
        } else {
          logger.fatal({ code: errorCode(err) }, "database startup failed");
        }
        process.exit(1);
      },
      loadServers: async () => {
        if (database === undefined) return; // bootSequence only calls this with a database
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
          logger.info({ servers: stored.loaded }, "servers loaded from the database");
          for (const serverPublicId of stored.ownershipSeeded) {
            logger.info({ serverPublicId, source: "startup_seed" }, "ownership seeded");
          }
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
          // Nothing is stored: the backend serves no server (create and import-servers add them). Servers configured in the
          // environment are NOT served in database mode (#196); say so once, by variable name only.
          warnEnvServersNotServed(logger, configuredServerEnvNamesInUse());
          serversRegistered = true;
          logger.info({ servers: 0 }, "no servers are stored in the database yet");
        }
      },
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

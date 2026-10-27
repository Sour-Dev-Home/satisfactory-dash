import { endpoints, ownValue, ProductionGraphResponseSchema, type Command } from "@satisfactory-dash/shared";
import {
  errorForbidden,
  errorServiceUnavailable,
  metricsChartsDay,
  metricsOverviewAvailable,
  metricsOverviewUnavailable,
  metricsOverviewWithCharts,
  agentEnrollmentCodeResponse,
  agentRevokeResponse,
  agentStatusEnrolled,
  agentStatusEnrolledSilent,
  agentStatusNotEnrolled,
  alertDeleteDestinationResponse,
  alertDeleteRuleResponse,
  alertDestinationsConfigured,
  alertDestinationsNone,
  alertDestinationsWebhookGone,
  alertEventsEmpty,
  alertEventsLastPage,
  alertEventsPage,
  alertMuteClearedResponse,
  alertMuteSetResponse,
  alertPatchDiscordResponseDisabledManually,
  alertRuleCreated,
  alertRulesList,
  alertRuleUpdatedPresetDisabled,
  alertSendTestOk,
  alertStatusQuiet,
  alertStatusShadowMutedFiring,
  pushConfigDisabled,
  pushConfigEnabled,
  pushOptInOff,
  pushOptInOn,
  pushSubscribeResponse,
  pushUnsubscribeResponse,
  autoPauseResponseAccepted,
  commandFailed,
  commandSent,
  commandSucceeded,
  deleteServerDone,
  errorImportRequired,
  errorLanRequiresCertPinning,
  errorLoginFailed,
  errorRateLimited,
  errorUnknownCode,
  errorUpstreamAuthRejected,
  errorUpstreamUnreachable,
  errorWithDetail,
  bottlenecksBeltLevel,
  bottlenecksEmpty,
  bottlenecksItemLevelOldFrm,
  bottlenecksUnknownKind,
  factoryEmpty,
  factoryMixed,
  factoryUnreachable,
  factoryStatesAndIngredients,
  factoryUnknownItem,
  healthOk,
  historyItems7d,
  historyPower24h,
  historyTransitions24h,
  managedServersAllStates,
  productionGraphEmpty,
  productionGraphFactories,
  productionGraphStalled,
  productionGraphTwoSites,
  plannerDesignationDeleteResponse,
  plannerDesignationIronLine,
  managedServersWithAgent,
  renameAgentServerResponse,
  managedServersEmpty,
  playersAvailable,
  playersUnavailable,
  powerAtRisk,
  powerCharging,
  powerDischarging,
  powerEmpty,
  powerHistoryEmpty,
  powerHistoryFuseTrip,
  powerHistoryNormal,
  powerHistoryPaused,
  powerOk,
  powerOutage,
  powerStale,
  powerUnreachable,
  mapMarkersWorldResponse,
  powerLinesWorldResponse,
  railsWorldResponse,
  railsWorldResponseEmpty,
  railsWorldResponseTruncated,
  resourceNodesWorldResponse,
  resourceNodesWorldResponseEmpty,
  serverConnectionOk,
  serversMultiple,
  serversNone,
  serversRoleOwner,
  serversRoleViewer,
  serversSingle,
  sessionAnonymous,
  sessionAuthenticated,
  sessionAuthenticatedWithAccount,
  settingsEditable,
  settingsPending,
  settingsReadOnly,
  statusNoGame,
  statusPaused,
  statusRunning,
  statusSlow,
  statusStale,
  statusUnreachable,
  testConnectionApiUnauthorized,
  testConnectionPassed,
} from "@satisfactory-dash/shared/fixtures";
import { mapLiveResponse, mapLiveResponseEmpty, mapLiveResponseStale } from "./mapLiveResponses";
import { mapMarkersWorldResponseEmpty, mapMarkersWorldResponseTruncated } from "./mapMarkersResponses";
import { powerLinesWorldResponseEmpty, powerLinesWorldResponseTruncated } from "./powerLinesResponses";
import { accountDeleted, errorOperatorServers, errorReauthRequired, serverLeft } from "./accountMocks";
import {
  createdAgentServer,
  errorDailyLimit,
  errorLimitAccount,
  errorLimitPending,
  errorLimitService,
  errorSelfServeOff,
  listOwnsEnrolled,
  listOwnsPending,
  listSelfServeEmpty,
  listSelfServeOff,
  listSelfServeOn,
} from "./selfServeMocks";
import { compatPolicy, compatQuiet, reporting } from "./updateMocks";
import { approved, errorPairingForbidden, errorPairingNotFound, errorPairingRateLimited, lookedUp } from "./pairingMocks";

// Named UI states, built only from the shared fixtures. One source for both consumers:
// the dev mock mode (src/test/browser.ts, MSW in the browser) and the Playwright tests
// (e2e/, page.route). Test/dev only: never imported by production code paths.

/** A canned response. `text` sends a non-JSON body (e.g. a proxy's error page). */
export interface MockResponse {
  status: number;
  body?: unknown;
  text?: string;
  /** "never" leaves the request hanging, to show a loading state. */
  delay?: number | "never";
  /** Extra response headers (e.g. a 429's Retry-After). */
  headers?: Record<string, string>;
}

export const ROUTES = {
  health: endpoints.health,
  session: endpoints.auth.session,
  login: endpoints.auth.login,
  logout: endpoints.auth.logout,
  logoutAll: endpoints.auth.logoutAll,
  servers: endpoints.servers,
  status: endpoints.status,
  players: endpoints.players,
  power: endpoints.power,
  powerHistory: endpoints.powerHistory,
  factory: endpoints.factory,
  bottlenecks: endpoints.bottlenecks,
  // ADR-0050: the Planner page (task 5).
  productionGraph: endpoints.productionGraph,
  // ADR-0055 PR 10a: the player's designated factories, and their writes.
  plannerDesignations: endpoints.plannerDesignations.list,
  plannerDesignationCreate: endpoints.plannerDesignations.create,
  plannerDesignationUpdate: endpoints.plannerDesignations.update,
  plannerDesignationRemove: endpoints.plannerDesignations.remove,
  // ADR-0038 M5: the two world layers share one endpoint and tell apart by the path's `:layer`
  // (WORLD_LAYER_ROUTES below).
  mapRails: endpoints.map.worldLayer,
  // ADR-0056: the operator's metrics page (the window is a query string, which doesn't change the route).
  metrics: endpoints.metrics.overview,
  mapResourceNodes: endpoints.map.worldLayer,
  // ADR-0038 §1 (#330): the players' map markers and stamps, the same endpoint.
  mapMarkers: endpoints.map.worldLayer,
  // ADR-0038 §1 (#330): the power lines, the same endpoint (off by default on the page, so asked for once toggled on).
  mapPowerLines: endpoints.map.worldLayer,
  // ADR-0038 M6: the live trains and stations (its own endpoint).
  mapLive: endpoints.map.live,
  settings: endpoints.settings.get,
  setAutoPause: endpoints.settings.setAutoPause,
  // ADR-0030, operator only.
  managedServers: endpoints.serverManagement.list,
  testConnection: endpoints.serverManagement.testConnection,
  testSaved: endpoints.serverManagement.testSaved,
  createServer: endpoints.serverManagement.create,
  updateServer: endpoints.serverManagement.update,
  removeServer: endpoints.serverManagement.remove,
  // ADR-0046: any signed-in user adds a server of their own.
  createAgentServer: endpoints.selfServe.createAgentServer,
  // ADR-0051 section 1: the /pair page.
  pairingLookup: endpoints.pairings.lookup,
  pairingApprove: endpoints.pairings.approve,
  // ADR-0031: an agent server's only edits (#266 rename, #273 switch back to local).
  renameAgent: endpoints.serverManagement.renameAgent,
  switchToLocal: endpoints.serverManagement.switchToLocal,
  // ADR-0027 stored history (the query string doesn't change the route).
  historyPower: endpoints.history.power,
  historyItems: endpoints.history.items,
  historyTransitions: endpoints.history.transitions,
  // ADR-0027 PR 9 alerts. The status is read on every page (the header bell).
  alertStatus: endpoints.alerts.status,
  alertRules: endpoints.alerts.rules.list,
  alertDestinations: endpoints.alerts.destinations.get,
  alertEvents: endpoints.alerts.events,
  // ADR-0031: a change relayed through the game PC's agent, followed to its result.
  command: endpoints.commands.get,
  // ADR-0031 PR 7: the game PC's agent on Settings (status and revoke share a path, told apart by method).
  agentStatus: endpoints.agent.status,
  agentEnrollmentCode: endpoints.agent.enrollmentCode,
  agentRevoke: endpoints.agent.revoke,
  // ADR-0057 Decision 7: the version policy the update banners compare with.
  compat: endpoints.compat,
  // ADR-0027 PR 9c: the owner/admin writes (same paths as the reads, told apart by method).
  alertRuleCreate: endpoints.alerts.rules.create,
  alertRuleUpdate: endpoints.alerts.rules.update,
  alertRuleRemove: endpoints.alerts.rules.remove,
  alertDiscordPut: endpoints.alerts.destinations.putDiscord,
  alertDiscordPatch: endpoints.alerts.destinations.patchDiscord,
  alertDiscordRemove: endpoints.alerts.destinations.removeDiscord,
  alertDiscordTest: endpoints.alerts.destinations.testDiscord,
  alertMuteSet: endpoints.alerts.mute.set,
  alertMuteClear: endpoints.alerts.mute.clear,
  // ADR-0044 web push (the opt-in's read and write share a path, told apart by method).
  pushConfig: endpoints.push.config,
  pushOptIn: endpoints.push.optIn.get,
  pushOptInSet: endpoints.push.optIn.put,
  pushSubscribe: endpoints.push.subscribe,
  pushUnsubscribe: endpoints.push.unsubscribe,
  pushTest: endpoints.push.test,
  // ADR-0047: deleting your own account, and leaving a server.
  deleteAccount: endpoints.account.remove,
  leaveServer: endpoints.members.leave,
} as const;
export type RouteKey = keyof typeof ROUTES;

/** A route's entry, reading own keys only (#368); an unknown key is a bug in the mocks, so it throws. */
export function routeFor<K extends RouteKey>(key: K): (typeof ROUTES)[K] {
  const route = ownValue(ROUTES, key);
  if (route === undefined) throw new Error(`no mock route ${String(key)}`);
  return route as (typeof ROUTES)[K];
}

/** The routes that share an endpoint with another and are told apart by the last path segment. */
export const WORLD_LAYER_ROUTES = {
  mapRails: "rails",
  mapResourceNodes: "resourceNodes",
  mapMarkers: "mapMarkers",
  mapPowerLines: "powerLines",
} as const;

/** A route's path pattern as a router sees it: the world-layer routes have their `:layer` filled in. */
export function routePattern(key: RouteKey): string {
  const route = routeFor(key).route;
  const layer = ownValue(WORLD_LAYER_ROUTES, key);
  return layer === undefined ? route : route.replace(":layer", layer);
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const fail = (status: number, body: unknown): MockResponse => ({ status, body });

/**
 * A relayed command with its expiry moved far ahead: the fixtures' fixed expiry is in the past on a
 * real clock, and the page stops waiting at a command's expiry.
 */
const live = (answer: { command: Command }) => ({ command: { ...answer.command, expiresAt: "2099-01-01T00:00:00.000Z" } });

/** Auto-pause on a server reached through the agent: the PUT answers 202 with the command to follow. */
const relayed = (result: { command: Command }): Partial<Record<RouteKey, MockResponse>> => ({
  setAutoPause: { status: 202, body: live(autoPauseResponseAccepted) },
  command: ok(live(result)),
});

/** A signed-in operator with one healthy server. */
const BASE: Record<RouteKey, MockResponse> = {
  health: ok(healthOk),
  session: ok(sessionAuthenticated),
  login: ok(sessionAuthenticated),
  logout: ok(sessionAnonymous),
  logoutAll: ok(sessionAnonymous),
  servers: ok(serversSingle),
  status: ok(statusRunning),
  // No player list (no FicsitRemoteMonitoring): the card shows counts only, as before names.
  players: ok(playersUnavailable),
  power: ok(powerOk),
  powerHistory: ok(powerHistoryNormal),
  factory: ok(factoryMixed),
  bottlenecks: ok(bottlenecksBeltLevel),
  // Two sites, one machine on no conveyor yet (beltData "stale"), a loop, a mixed belt and an estimated edge.
  productionGraph: ok(productionGraphTwoSites),
  plannerDesignations: ok({ designations: [], matches: [] }),
  plannerDesignationCreate: { status: 201, body: plannerDesignationIronLine },
  plannerDesignationUpdate: ok(plannerDesignationIronLine),
  plannerDesignationRemove: ok(plannerDesignationDeleteResponse),
  mapRails: ok(railsWorldResponse),
  mapResourceNodes: ok(resourceNodesWorldResponse),
  mapMarkers: ok(mapMarkersWorldResponse),
  mapPowerLines: ok(powerLinesWorldResponse),
  mapLive: ok(mapLiveResponse),
  metrics: ok(metricsOverviewWithCharts),
  settings: ok(settingsEditable),
  setAutoPause: ok(settingsEditable),
  managedServers: ok(managedServersAllStates),
  testConnection: ok(testConnectionPassed),
  testSaved: ok(testConnectionPassed),
  createServer: ok(serverConnectionOk),
  updateServer: ok(serverConnectionOk),
  removeServer: ok(deleteServerDone),
  createAgentServer: { status: 201, body: createdAgentServer },
  pairingLookup: ok(lookedUp),
  pairingApprove: ok(approved),
  renameAgent: ok(renameAgentServerResponse),
  switchToLocal: ok(serverConnectionOk),
  historyPower: ok(historyPower24h),
  // Two hours only: "Since yesterday" says there isn't enough history yet (ADR-0027 PR 8b).
  historyItems: ok(historyItems7d),
  historyTransitions: ok(historyTransitions24h),
  // Quiet: the bell shows no badge on every other state's screenshot.
  alertStatus: ok(alertStatusQuiet),
  alertRules: ok(alertRulesList),
  alertDestinations: ok(alertDestinationsConfigured),
  alertEvents: ok(alertEventsLastPage),
  command: ok(live(commandSucceeded)),
  // A server the backend reaches directly, with no agent: Settings shows the agent section's first state.
  agentStatus: ok(agentStatusNotEnrolled),
  agentEnrollmentCode: { status: 201, body: agentEnrollmentCodeResponse },
  agentRevoke: ok(agentRevokeResponse),
  // Nothing newer than the fixtures' agent, so no state but the update ones shows a version banner.
  compat: ok(compatQuiet),
  // Each write answers as the backend would; the page re-reads or patches its cache from these.
  alertRuleCreate: { status: 201, body: alertRuleCreated },
  alertRuleUpdate: ok(alertRuleUpdatedPresetDisabled),
  alertRuleRemove: ok(alertDeleteRuleResponse),
  alertDiscordPut: ok({ discord: alertDestinationsConfigured.discord }),
  alertDiscordPatch: ok(alertPatchDiscordResponseDisabledManually),
  alertDiscordRemove: ok(alertDeleteDestinationResponse),
  alertDiscordTest: ok(alertSendTestOk),
  alertMuteSet: ok(alertMuteSetResponse),
  alertMuteClear: ok(alertMuteClearedResponse),
  // Push is off on the backend: the Alerts panel explains it. The e2e browser supplies the device's state.
  pushConfig: ok(pushConfigDisabled),
  pushOptIn: ok(pushOptInOff),
  pushOptInSet: ok(pushOptInOn),
  pushSubscribe: { status: 201, body: pushSubscribeResponse },
  pushUnsubscribe: ok(pushUnsubscribeResponse),
  pushTest: ok(alertSendTestOk),
  deleteAccount: ok(accountDeleted),
  leaveServer: ok(serverLeft),
};

/** The finder skipped the conveyors layer (over the 2 MB world-layer cap): item level with its own note, not the FRM one. */
const bottlenecksTooLarge = {
  ...bottlenecksItemLevelOldFrm,
  data: {
    ...bottlenecksItemLevelOldFrm.data,
    beltData: "tooLarge" as const,
    notes: [
      {
        code: "beltDataTooLarge",
        text: "Item-level results only: this factory's connection data is too large to read.",
      },
    ],
  },
};

/** The agent has sent no usable conveyors layer yet (an agent built before #570, or not read yet): not an FRM problem. */
const bottlenecksNotReceived = {
  ...bottlenecksItemLevelOldFrm,
  data: {
    ...bottlenecksItemLevelOldFrm.data,
    beltData: "notReceived" as const,
    notes: [
      {
        code: "beltDataNotReceived",
        text: "Item-level results only. The agent hasn't sent belt data yet. If this stays, update the agent; it reads belts every 10 minutes.",
      },
    ],
  },
};

/** The planner when the conveyors layer could not be used: no edges, no sites, and the finder's own note for the mode. */
const plannerItemLevel = (beltData: "unsupported" | "tooLarge" | "notReceived", note: { code: string; text: string }) => ({
  ...productionGraphEmpty,
  data: { ...productionGraphEmpty.data, beltData, notes: [note] },
});

/**
 * ADR-0055 PR 7: the factories fixture with a second Iron Plate tree in the Iron Plate factory (a bubble of two groups
 * and a bubble of one, both "Iron Plate"), so the tables show trees, ordinals and an indented bubble.
 */
const plannerFactoriesTwoTrees = (() => {
  const data = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
  const first = data.nodes.find((n) => n.recipe === "Iron Plate")!;
  const second = {
    ...first,
    key: "Build_ConstructorMk1_C|Iron Plate|1260|10",
    machineIds: ["Build_ConstructorMk1_C_9"],
    count: 1,
    treeKey: "tree|Desc_IronPlate_C|1260|10",
    at: { x: 1260, y: 10 },
    products: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" as const, currentPerMinute: 12, maxPerMinute: 20 }],
  };
  const sibling = { ...first, key: "Build_ConstructorMk1_C|Iron Plate|1270|0", machineIds: ["Build_ConstructorMk1_C_8"], count: 1, treeKey: first.treeKey, at: { x: 1270, y: 0 } };
  const nodes = data.nodes.map((n) => (n === first ? { ...n, treeKey: "tree|Desc_IronPlate_C|1250|0" } : n));
  const plateFactory = data.factories![0];
  return {
    ...productionGraphFactories,
    data: {
      ...data,
      nodes: [...nodes, { ...sibling, treeKey: "tree|Desc_IronPlate_C|1250|0" }, second],
      factories: [
        { ...plateFactory, nodeKeys: [...plateFactory.nodeKeys, sibling.key, second.key], machineCount: plateFactory.machineCount + 2 },
        ...data.factories!.slice(1),
      ],
      sites: data.sites.map((s) => (s.nodeKeys.includes(first.key) ? { ...s, nodeKeys: [...s.nodeKeys, sibling.key, second.key] } : s)),
    },
  };
})();

/**
 * ADR-0055 PR 10a: the factories fixture with one id per machine (its own is one per group) and a building for each at the
 * group's place, the Iron Rod factory designated "Rod works" by two machines it holds and one it no longer finds, and the
 * viewer an owner. The Iron Plate factory stays automatic, for the suggestions and the "Designate selected" form.
 */
const plannerDesignated = (() => {
  const base = ProductionGraphResponseSchema.parse(productionGraphFactories);
  const nodes = base.data.nodes.map((n) => ({ ...n, machineIds: Array.from({ length: n.count }, (_, i) => `${n.className}|${n.key}|${i}`) }));
  const buildings = nodes.flatMap((n) =>
    n.machineIds.map((id, i) => ({
      ...factoryMixed.data.buildings[0],
      id,
      name: n.name,
      className: n.className,
      location: { xM: n.at.x + i * 4, yM: n.at.y, zM: 0, rotationDeg: 0 },
    })),
  );
  const rod = nodes.find((n) => n.key === "Build_ConstructorMk1_C|Iron Rod|1250|100")!;
  const live = rod.machineIds.map((id, i) => ({ id, c: rod.className, x: rod.at.x + i * 4, y: rod.at.y }));
  const gone = { id: "Build_ConstructorMk1_C_retired", c: rod.className, x: 4000, y: 4000 };
  const id = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
  return {
    servers: ok(serversRoleOwner),
    productionGraph: ok({
      ...productionGraphFactories,
      data: {
        ...base.data,
        nodes,
        factories: base.data.factories!.map((f) => (f.name === "Iron Rod factory" ? { ...f, name: "Rod works", designationId: id, sideProducts: [] } : f)),
      },
    }),
    factory: ok({ ...factoryMixed, data: { ...factoryMixed.data, buildings, backedUpCount: 0, stateCounts: {} } }),
    plannerDesignations: ok({
      designations: [
        { id, name: "Rod works", mode: "core", members: [...live, gone], createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-22T18:30:00.000Z" },
      ],
      matches: [{ designationId: id, matched: live.length, missing: 1 }],
    }),
  } satisfies Partial<Record<RouteKey, MockResponse>>;
})();

/**
 * ADR-0055 PR 8: the factories fixture with one transport of every mode the canvas has a glyph for (the train is the
 * fixture's own; only the train and the Depot have readers today, so the truck and the drone are synthetic), between the
 * Iron Plate factory's groups, so the canvas shows all four icons and the legend lists them.
 */
const plannerFactoriesTransports = (() => {
  const data = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
  const keyOf = (className: string) => data.nodes.find((n) => n.className === className)!.key;
  const train = data.transports![0];
  const via = (mode: string, from: string, to: string, routeName: string) => ({ ...train, mode, from, to, routeName, carriers: 1 });
  return {
    ...productionGraphFactories,
    data: {
      ...data,
      transports: [
        train,
        via("truck", keyOf("Build_SmelterMk1_C"), keyOf("Build_ConstructorMk1_C"), "Plate Run"),
        via("drone", keyOf("Build_ConstructorMk1_C"), keyOf("Build_StorageContainerMk1_C"), "Courier"),
        via("depot", keyOf("Build_TrainStation_C"), keyOf("Build_SmelterMk1_C"), "Upload"),
      ],
    },
  };
})();

/** The factory read with the planner fixture's constructor manifold in it (Build_ConstructorMk1_C_1..8), for the graph's group panel. */
const factoryWithPlannerManifold = {
  ...factoryMixed,
  data: {
    ...factoryMixed.data,
    buildings: Array.from({ length: 8 }, (_, i) => ({
      ...factoryMixed.data.buildings[0],
      id: `Build_ConstructorMk1_C_${i + 1}`,
      name: "Constructor",
      className: "Build_ConstructorMk1_C",
      recipe: "Iron Plate",
      state: i < 6 ? "producing" : "underfed",
      isBackedUp: false,
      clockSpeedPercent: i === 7 ? 150 : 100,
      production: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" as const, currentPerMinute: 9 + i, maxPerMinute: 20, percent: ((9 + i) / 20) * 100 }],
    })),
    backedUpCount: 0,
    stateCounts: { producing: 6, underfed: 2 },
  },
};

/** The same manifold with its storage full (#728): every constructor backed up at 0 of 20 Iron Plate. */
const factoryStalledManifold = {
  ...factoryWithPlannerManifold,
  data: {
    ...factoryWithPlannerManifold.data,
    buildings: factoryWithPlannerManifold.data.buildings.map((b) => ({
      ...b,
      state: "backedUp",
      isBackedUp: true,
      clockSpeedPercent: 100,
      production: b.production.map((r) => ({ ...r, currentPerMinute: 0, maxPerMinute: 20, percent: 0 })),
    })),
    backedUpCount: 8,
    stateCounts: { backedUp: 8 },
  },
};

/** The factory's bottleneck finding moved onto a machine the planner fixture has (its constructor manifold, Iron Plate). */
const bottlenecksOnPlannerSite = {
  ...bottlenecksBeltLevel,
  data: {
    ...bottlenecksBeltLevel.data,
    findings: bottlenecksBeltLevel.data.findings.slice(0, 1).map((f) => ({
      ...f,
      buildingId: "Build_ConstructorMk1_C_3",
      affectedCount: 2,
      affected: [
        { buildingId: "Build_ConstructorMk1_C_3", buildingName: "Constructor", recipe: "Iron Plate" },
        { buildingId: "Build_ConstructorMk1_C_4", buildingName: "Constructor", recipe: "Iron Plate" },
      ],
    })),
  },
};

/**
 * ADR-0047: an account stored in the database (it names its sign-in methods, so it can be deleted) that signed in with
 * Google, on a backend that offers Google: the recent-sign-in refusal then offers "Sign in again with Google".
 */
const googleAccount = ok({ ...sessionAuthenticatedWithAccount, signInMethods: ["google"] });

/** The operator with one server: the Servers tab shows (ADR-0030). */
const operatorSingle = ok({ ...serversSingle, canManageServers: true });

/**
 * ADR-0056: the metrics page with every table filled: all four latency groups, both counter groups, the worst servers,
 * and an alert month per kind, plus the day's charts (amendment 2026-10-26). Built from the shared metrics fixtures' own
 * rows, so a contract change shows here.
 */
const metricsFull = (() => {
  const base = metricsOverviewAvailable;
  const [histogram] = base.system.histograms;
  const [counter] = base.system.counters;
  return {
    ...base,
    window: "24h" as const,
    charts: metricsChartsDay,
    system: {
      ...base.system,
      histograms: [
        histogram,
        { ...histogram, labels: { route: "/api/health", status_class: "5xx" }, count: 3, p50Ms: 200, p95Ms: 500, p99Ms: 500 },
        { ...histogram, metric: "http.server.upstream.duration", labels: { api: "frm" }, p50Ms: 10, p95Ms: 50, p99Ms: 1000 },
        { ...histogram, metric: "db.client.operation.duration", labels: { query: "history.insertPowerSamples" }, p50Ms: 2, p95Ms: 10, p99Ms: 20 },
        { ...histogram, metric: "satis.poller.lag", labels: { group: "status" }, p50Ms: 1000, p95Ms: 2000, p99Ms: null },
      ],
      counters: [
        { ...counter, metric: "satis.history.rows_written", labels: {}, total: 41230 },
        counter,
        { ...counter, metric: "satis.alerts.events_dropped", labels: {}, total: 0 },
      ],
      servers: [...base.system.servers, { ...base.system.servers[0], server: "def456" }],
    },
    alerts: {
      ...base.alerts,
      months: [
        ...base.alerts.months,
        { month: "2026-02", kind: "power_outage", fired: 3, flaps: 0, medianResolveSeconds: 1260 },
        { month: "2026-02", kind: "stopped_machines", fired: 5, flaps: 1, medianResolveSeconds: 2400 },
      ],
    },
  };
})();

const upstreamDown = (error: unknown): Partial<Record<RouteKey, MockResponse>> => ({
  status: fail(502, error),
  power: fail(502, error),
  powerHistory: fail(502, error),
  factory: fail(502, error),
  productionGraph: fail(502, error),
  settings: fail(502, error),
});

/** A full 12-slot server with `online` connected: the count and the FRM names agree (ADR-0029). */
const players12 = (online: number): Partial<Record<RouteKey, MockResponse>> => ({
  status: ok({ ...statusRunning, data: { ...statusRunning.data, connectedPlayers: online, playerLimit: 12 } }),
  players: ok({
    ...playersAvailable,
    players: Array.from({ length: 12 }, (_, i) => ({
      ...playersAvailable.players[0],
      name: `Pioneer-${String(i + 1).padStart(2, "0")}`,
      online: i < online,
    })),
  }),
});

/** A page's data reads, each answering after this long: past the 400 ms page budget (#494), so the pages show skeletons. */
const SLOW_MS = 800;
const slow = (response: MockResponse): MockResponse => ({ ...response, delay: SLOW_MS });

/** Every state the visual checks cover (ADR-0016 item 5). Keys are URL-safe. */
export const SCENARIOS = {
  default: {},
  // Every page's primary reads answer slowly (#494): the page waits its budget, reveals with skeletons
  // where the data isn't in, then fills each panel without moving the layout.
  // Some reads never answer, so each page holds its skeletons for a screenshot (#494): the factory
  // (Factory and Map), the stored history, the live power history, the agent's status and the alert rules.
  "loading-panels": {
    factory: { ...BASE.factory, delay: "never" },
    bottlenecks: { ...BASE.bottlenecks, delay: "never" },
    productionGraph: { ...BASE.productionGraph, delay: "never" },
    historyItems: { ...BASE.historyItems, delay: "never" },
    historyTransitions: { ...BASE.historyTransitions, delay: "never" },
    powerHistory: { ...BASE.powerHistory, delay: "never" },
    agentStatus: { ...BASE.agentStatus, delay: "never" },
    alertRules: { ...BASE.alertRules, delay: "never" },
  },
  "slow-queries": {
    status: slow(BASE.status),
    players: slow(BASE.players),
    power: slow(BASE.power),
    powerHistory: slow(BASE.powerHistory),
    factory: slow(BASE.factory),
    bottlenecks: slow(BASE.bottlenecks),
    productionGraph: slow(BASE.productionGraph),
    mapRails: slow(BASE.mapRails),
    mapResourceNodes: slow(BASE.mapResourceNodes),
    mapMarkers: slow(BASE.mapMarkers),
    mapPowerLines: slow(BASE.mapPowerLines),
    mapLive: slow(BASE.mapLive),
    settings: slow(BASE.settings),
    managedServers: slow(BASE.managedServers),
    historyPower: slow(BASE.historyPower),
    historyItems: slow(BASE.historyItems),
    historyTransitions: slow(BASE.historyTransitions),
    agentStatus: slow(BASE.agentStatus),
    alertStatus: slow(BASE.alertStatus),
    alertRules: slow(BASE.alertRules),
    alertDestinations: slow(BASE.alertDestinations),
  },
  "loading": { session: { status: 200, delay: "never" } },
  "login": { session: ok(sessionAnonymous) },
  // A backend with Google sign-in on (ADR-0025): the button shows above the password form.
  "login-google": { session: ok({ ...sessionAnonymous, signInMethods: ["password", "google"] }) },
  // The backend's redirect after a failed Google sign-in (the text is fixed, never the query).
  "login-google-error": { session: ok({ ...sessionAnonymous, signInMethods: ["password", "google"] }) },
  // #568: an existing account that accepted an older Terms version is sent back to accept the current one.
  "login-terms-changed": { session: ok({ ...sessionAnonymous, signInMethods: ["password", "google"] }) },
  "login-failed": { session: ok(sessionAnonymous), login: fail(401, errorLoginFailed) },
  "login-rate-limited": { session: ok(sessionAnonymous), login: fail(429, errorRateLimited) },
  "no-servers": { servers: ok(serversNone) },
  "server-picker": { servers: ok(serversMultiple) },
  "paused": { status: ok(statusPaused) },
  "stale": { status: ok(statusStale), power: ok(powerStale) },
  // ADR-0052: the game is unreachable, and the backend serves each part's last reading, stale, with when it went down.
  "unreachable-last-data": {
    status: ok(statusUnreachable),
    power: ok(powerUnreachable),
    factory: ok(factoryUnreachable),
  },
  "slow-tick": { status: ok(statusSlow) },
  // The Players card's filled figures and its "+N" (every status fixture has 0 connected).
  // With FicsitRemoteMonitoring: 3 online, matching the count, so the names show (ADR-0029).
  "players-some": {
    status: ok({ ...statusRunning, data: { ...statusRunning.data, connectedPlayers: 3 } }),
    players: ok(playersAvailable),
  },
  "players-many": {
    status: ok({ ...statusRunning, data: { ...statusRunning.data, connectedPlayers: 10, playerLimit: 12 } }),
  },
  // The game's default limit of 12, a figure per slot: empty, part full, full.
  "players-0-of-12": players12(0),
  "players-7-of-12": players12(7),
  "players-12-of-12": players12(12),
  "no-game": { status: ok(statusNoGame), power: ok(powerEmpty), factory: ok(factoryEmpty) },
  "outage": { power: ok(powerOutage) },
  "at-risk": { power: ok(powerAtRisk) },
  // The live power chart (ADR-0022).
  "history-paused": { powerHistory: ok(powerHistoryPaused) },
  "history-empty": { powerHistory: ok(powerHistoryEmpty) },
  "history-fuse-trip": { power: ok(powerOutage), powerHistory: ok(powerHistoryFuseTrip) },
  "battery-charging": { power: ok(powerCharging) },
  "battery-discharging": { power: ok(powerDischarging) },
  "unknown-units": { factory: ok(factoryUnknownItem) },
  // ADR-0038 M5, the map's world layers: nothing read yet, a layer cut to its cap, or the read failing.
  "map-world-empty": {
    mapRails: ok(railsWorldResponseEmpty),
    mapResourceNodes: ok(resourceNodesWorldResponseEmpty),
    mapMarkers: ok(mapMarkersWorldResponseEmpty),
  },
  "map-world-truncated": { mapRails: ok(railsWorldResponseTruncated) },
  "map-world-error": {
    mapRails: fail(502, errorUpstreamUnreachable),
    mapResourceNodes: fail(502, errorUpstreamUnreachable),
    mapMarkers: fail(502, errorUpstreamUnreachable),
  },
  // ADR-0038 §1 (#330), the players' markers: the layer cut to its cap (empty and failing are in the two above).
  "map-markers-truncated": { mapMarkers: ok(mapMarkersWorldResponseTruncated) },
  // ADR-0038 §1 (#330), the power lines (off by default, so their states act on the toggle): none built yet, cut to the
  // layer's cap, and the read failing. The default scenario has the two captured lines.
  "map-power-lines-empty": { mapPowerLines: ok(powerLinesWorldResponseEmpty) },
  "map-power-lines-truncated": { mapPowerLines: ok(powerLinesWorldResponseTruncated) },
  "map-power-lines-error": { mapPowerLines: fail(502, errorUpstreamUnreachable) },
  // ADR-0038 M6, the live trains: none built yet, the game unreachable (last known positions), or the read failing.
  "map-live-empty": { mapLive: ok(mapLiveResponseEmpty) },
  "map-live-stale": { mapLive: ok(mapLiveResponseStale) },
  "map-live-error": { mapLive: fail(502, errorUpstreamUnreachable) },
  // Ingredients and every machine state (ADR-0027), plus an unknown state, none, and an older backend.
  "factory-states": { factory: ok(factoryStatesAndIngredients) },
  // ADR-0048 (#349), the Bottlenecks section: an older FRM (item level, update note), connection data over the cap,
  // nothing to report, and a newer backend's unknown step kind and note.
  "bottlenecks-old-frm": { bottlenecks: ok(bottlenecksItemLevelOldFrm) },
  "bottlenecks-too-large": { bottlenecks: ok(bottlenecksTooLarge) },
  "bottlenecks-not-received": { bottlenecks: ok(bottlenecksNotReceived) },
  "bottlenecks-empty": { bottlenecks: ok(bottlenecksEmpty) },
  "bottlenecks-unknown-kind": { bottlenecks: ok(bottlenecksUnknownKind) },
  // ADR-0050 task 5, the Planner page at /app/planner (default shows two sites, a loop, a mixed belt, an estimated edge and
  // a machine on no conveyor yet): an empty factory, belt data unavailable (older FRM, over the cap), the data stale, a
  // bottleneck finding on a planner machine (the per-site count), and the read failing.
  "planner-empty": { productionGraph: ok(productionGraphEmpty) },
  "planner-old-frm": {
    productionGraph: ok(
      plannerItemLevel("unsupported", { code: "updateFrm", text: "Item-level results only. Update FRM to 1.5.4 or newer for belt detail." }),
    ),
  },
  "planner-too-large": {
    productionGraph: ok(
      plannerItemLevel("tooLarge", {
        code: "beltDataTooLarge",
        text: "Item-level results only: this factory's connection data is too large to read.",
      }),
    ),
  },
  "planner-not-received": {
    productionGraph: ok(
      plannerItemLevel("notReceived", {
        code: "beltDataNotReceived",
        text: "No production graph. The agent hasn't sent belt data yet. If this stays, update the agent; it reads belts every 10 minutes.",
      }),
    ),
  },
  "planner-stale": { productionGraph: ok({ ...productionGraphTwoSites, stale: true }) },
  // ADR-0055 PR 7: factories as the first level (two, sharing a smelter 60/40; a remote miner joined by a train; an overflow
  // to the sink and plates into storage), and the same with a second Iron Plate tree in one of them.
  "planner-factories": { productionGraph: ok(productionGraphFactories) },
  "planner-factories-trees": { productionGraph: ok(plannerFactoriesTwoTrees) },
  "planner-factories-transports": { productionGraph: ok(plannerFactoriesTransports) },
  // ADR-0055 PR 10a: an owner, one designated factory with a machine gone, and one automatic factory to designate or suggest.
  "planner-designations": plannerDesignated,
  // The iron site without its recycle loop's two connections: the recycler stands alone, so an item filter (Iron Ingot: 4 of
  // 5 groups) dims it and shows what the filter does.
  "planner-filter-dimmed": {
    productionGraph: ok({
      ...productionGraphTwoSites,
      data: { ...productionGraphTwoSites.data, edges: productionGraphTwoSites.data.edges.filter((_, i) => i !== 2 && i !== 3) },
    }),
  },
  "planner-bottlenecks": { bottlenecks: ok(bottlenecksOnPlannerSite) },
  // ADR-0050 task 6, the graph's group panel: the manifold's machines are in the factory read, and one has a finding.
  "planner-group-panel": { factory: ok(factoryWithPlannerManifold), bottlenecks: ok(bottlenecksOnPlannerSite) },
  // #728 step 2: a stalled group. The manifold is backed up at "0 of 160", its card says so in a muted line, and so does
  // its side panel; the recycler it feeds is underfed at 0.
  "planner-stalled": { productionGraph: ok(productionGraphStalled), factory: ok(factoryStalledManifold) },
  // ADR-0057 Decision 2 step 1: a vanilla-only server. The game answers (status, and no player list, as in BASE); nothing of
  // power or factory was ever served, so those reads fail as an agent server's never-reported part does.
  "basic-data": {
    power: fail(502, errorUpstreamUnreachable),
    powerHistory: fail(502, errorUpstreamUnreachable),
    factory: fail(502, errorUpstreamUnreachable),
    productionGraph: fail(502, errorUpstreamUnreachable),
    bottlenecks: fail(502, errorUpstreamUnreachable),
  },
  "planner-error": { productionGraph: fail(502, errorUpstreamUnreachable) },
  "settings-read-only": { settings: ok(settingsReadOnly) },
  "settings-pending": { settings: ok(settingsPending) },
  // ADR-0031 PR 4: after the toggle, the change is on its way to the game PC, or it failed there.
  "settings-relayed-saving": relayed(commandSent),
  "settings-relayed-failed": relayed(commandFailed),
  "upstream-unreachable": upstreamDown(errorUpstreamUnreachable),
  "upstream-auth-rejected": upstreamDown(errorUpstreamAuthRejected),
  "upstream-invalid": upstreamDown(errorWithDetail),
  "unknown-error-code": upstreamDown(errorUnknownCode),
  "backend-unreachable": { session: { status: 502, text: "Bad Gateway" } },
  // ADR-0054 D4: no connector is up for the backend, so Cloudflare answers every read with its HTML error page (530).
  // The last-data case (the notice over a filled page) needs a first answer and then the gap: it is in deployGap.test.tsx.
  "deploy-gap": {
    status: { status: 530, text: "<!DOCTYPE html><title>Error 1033</title>" },
    power: { status: 530, text: "<!DOCTYPE html><title>Error 1033</title>" },
    factory: { status: 530, text: "<!DOCTYPE html><title>Error 1033</title>" },
  },
  "contract-drift": { status: ok({ ...statusRunning, data: { ...statusRunning.data, gamePaused: "no" } }) },
  // Server management (ADR-0030), at /app/servers: one row per stored state (ok, unreadable, refused).
  "servers-manage": { servers: operatorSingle },
  // ADR-0056: the operator's metrics page: every table filled, each section's reason for having no data, a 429, and a failing read.
  "metrics": { servers: operatorSingle, metrics: ok(metricsFull) },
  "metrics-unavailable": { servers: operatorSingle, metrics: ok(metricsOverviewUnavailable) },
  // An older backend that sends no `charts` (amendment 2026-10-26): "Charts not available yet", the Details still render.
  "metrics-no-charts": { servers: operatorSingle, metrics: ok({ ...metricsFull, charts: undefined }) },
  "metrics-rate-limited": { servers: operatorSingle, metrics: { status: 429, body: errorRateLimited, headers: { "Retry-After": "60" } } },
  "metrics-error": { servers: operatorSingle, metrics: fail(503, errorServiceUnavailable) },
  // A signed-in user who isn't the operator: the page behaves as an unknown one.
  "metrics-forbidden": { metrics: fail(403, errorForbidden) },
  "metrics-slow": { servers: operatorSingle, metrics: { ...ok(metricsFull), delay: 800 } },
  "metrics-loading": { servers: operatorSingle, metrics: { ...BASE.metrics, delay: "never" } },
  // ADR-0031: a stored connection plus a server read through the game PC's agent.
  // Its switch back answers for that same server, so the success notice names it (ui review).
  "servers-with-agent": {
    servers: operatorSingle,
    managedServers: ok(managedServersWithAgent),
    switchToLocal: ok({
      server: {
        ...serverConnectionOk.server,
        id: managedServersWithAgent.agentServers[0].id,
        displayName: managedServersWithAgent.agentServers[0].displayName,
      },
    }),
  },
  // No server the backend can serve yet: the operator sets one up from the server gate.
  "servers-first": { servers: ok({ ...serversNone, canManageServers: true }), managedServers: ok(managedServersEmpty) },
  // Adding a LAN server is refused until certificate pinning exists (ADR-0030 amendment 1).
  "servers-lan-refused": {
    servers: operatorSingle,
    testConnection: fail(422, errorLanRequiresCertPinning),
    createServer: fail(422, errorLanRequiresCertPinning),
  },
  "servers-import-required": { servers: operatorSingle, createServer: fail(409, errorImportRequired) },
  "servers-test-failed": { servers: operatorSingle, testSaved: ok(testConnectionApiUnauthorized) },
  // Alerts (ADR-0027 PR 9), in the bell's dropdown: the shadow week, muted, one alert firing (the
  // bell's badge shows on every page), and a log with an older page.
  "alerts": { alertStatus: ok(alertStatusShadowMutedFiring), alertEvents: ok(alertEventsPage) },
  // Discord deleted the webhook: the destination turned itself off.
  "alerts-webhook-gone": { alertDestinations: ok(alertDestinationsWebhookGone) },
  // A server with nothing set up yet.
  "alerts-empty": { alertDestinations: ok(alertDestinationsNone), alertEvents: ok(alertEventsEmpty) },
  // Settings → Alerts (ADR-0027 PR 9c) as the server's owner (PR 7b role): the mute, the Discord
  // setup and the rules editor show; and as a viewer, who reads the same section without controls.
  "alerts-owner": { servers: ok(serversRoleOwner), alertStatus: ok(alertStatusShadowMutedFiring) },
  "alerts-viewer": { servers: ok(serversRoleViewer), alertStatus: ok(alertStatusShadowMutedFiring) },
  // ADR-0044, Settings → Alerts → push: enabled on the backend (this device is off, or in the state e2e
  // gives the browser: subscribed or blocked), and the member's opt-in already on.
  "push-enabled": { pushConfig: ok(pushConfigEnabled) },
  "push-opted-in": { pushConfig: ok(pushConfigEnabled), pushOptIn: ok(pushOptInOn) },
  "push-viewer": { servers: ok(serversRoleViewer), pushConfig: ok(pushConfigEnabled), pushOptIn: ok(pushOptInOn) },
  // ADR-0031 PR 7, Settings → Game PC agent. The operator on a server reached directly (can enrol);
  // an owner of a server with a reporting agent (can revoke or enrol again); one enrolled but never
  // heard from; and a viewer, who reads it with no controls.
  "agent-local-operator": { servers: operatorSingle },
  "agent-enrolled-owner": { servers: ok(serversRoleOwner), agentStatus: ok(agentStatusEnrolled) },
  "agent-silent-owner": { servers: ok(serversRoleOwner), agentStatus: ok(agentStatusEnrolledSilent) },
  "agent-enrolled-viewer": { servers: ok(serversRoleViewer), agentStatus: ok(agentStatusEnrolled) },
  // ADR-0057 Decision 7: the version banners. An agent behind the newest release; the mod behind it (applies at the next
  // restart); a version older than minSupported; a mod inside an advisory's range; and an agent below minSafe with no advisory.
  "update-agent": { servers: ok(serversRoleOwner), agentStatus: ok(reporting("0.3.5+ec24244.20261025")), compat: ok(compatPolicy) },
  "update-mod": { servers: ok(serversRoleOwner), agentStatus: ok(reporting("mod/1.1.5")), compat: ok(compatPolicy) },
  "update-unsupported": { servers: ok(serversRoleOwner), agentStatus: ok(reporting("0.1.5")), compat: ok({ ...compatPolicy, agent: { ...compatPolicy.agent, minSafe: "0.1.0" } }) },
  "update-advisory": { servers: ok(serversRoleOwner), agentStatus: ok(reporting("mod/1.0.5")), compat: ok(compatPolicy) },
  "update-servers": {
    servers: operatorSingle,
    managedServers: ok(managedServersWithAgent),
    agentStatus: ok(reporting("0.3.5")),
    compat: ok(compatPolicy),
  },
  "update-min-safe": { servers: ok(serversRoleOwner), agentStatus: ok(reporting("0.2.5")), compat: ok(compatPolicy) },
  // ADR-0046 (#529), Settings → Your server. Self-serve on for a player with no server of their own;
  // off; with no server at all (the add form is the screen); each refusal of "Add your server"; and the
  // owner of an enrolled and of a pending self-serve server.
  "self-serve-add": { servers: ok(listSelfServeOn) },
  "self-serve-off": { servers: ok(listSelfServeOff) },
  "self-serve-empty": { servers: ok(listSelfServeEmpty) },
  "self-serve-limit-account": { servers: ok(listSelfServeOn), createAgentServer: fail(409, errorLimitAccount) },
  "self-serve-limit-pending": { servers: ok(listSelfServeOn), createAgentServer: fail(409, errorLimitPending) },
  "self-serve-limit-service": { servers: ok(listSelfServeOn), createAgentServer: fail(409, errorLimitService) },
  "self-serve-limit-daily": {
    servers: ok(listSelfServeOn),
    createAgentServer: { status: 429, body: errorDailyLimit, headers: { "Retry-After": "18000" } },
  },
  "self-serve-forbidden": { servers: ok(listSelfServeOn), createAgentServer: fail(403, errorSelfServeOff) },
  // ADR-0051 section 1, the /pair page: a player who owns one server (so "One of my servers" has a choice), a code the
  // server does not accept, a wait, and a refusal.
  "pair": { servers: ok(serversRoleOwner) },
  "pair-invalid": { servers: ok(serversRoleOwner), pairingLookup: fail(404, errorPairingNotFound) },
  "pair-rate-limited": {
    servers: ok(serversRoleOwner),
    pairingLookup: { status: 429, body: errorPairingRateLimited, headers: { "Retry-After": "120" } },
  },
  "pair-forbidden": { servers: ok(serversRoleOwner), pairingLookup: fail(403, errorPairingForbidden) },
  "pair-approve-invalid": { servers: ok(serversRoleOwner), pairingApprove: fail(404, errorPairingNotFound) },
  "self-serve-owner": { servers: ok(listOwnsEnrolled), agentStatus: ok(agentStatusEnrolled) },
  "self-serve-owner-pending": {
    servers: ok(listOwnsPending),
    // Created through self-serve, so it is an agent server with nothing enrolled yet: the player can make a code.
    agentStatus: ok({ ...agentStatusNotEnrolled, connectionKind: "agent" }),
    agentEnrollmentCode: { status: 201, body: agentEnrollmentCodeResponse },
  },
  // ADR-0047 (#311 task 3), Settings → Your membership and Delete my account. The owner of a self-serve server (its
  // removal is named in the confirm); the deletion refused for an old sign-in, and for owning the operator's servers;
  // and a viewer, who can leave the server.
  "account-delete": { session: googleAccount, servers: ok(listOwnsEnrolled), agentStatus: ok(agentStatusEnrolled) },
  "account-reauth": {
    session: googleAccount,
    servers: ok(listOwnsEnrolled),
    agentStatus: ok(agentStatusEnrolled),
    deleteAccount: fail(403, errorReauthRequired),
  },
  "account-operator-servers": {
    session: googleAccount,
    servers: ok(listOwnsEnrolled),
    agentStatus: ok(agentStatusEnrolled),
    deleteAccount: fail(409, errorOperatorServers),
  },
  "account-leave": { session: googleAccount, servers: ok(serversRoleViewer) },
} satisfies Record<string, Partial<Record<RouteKey, MockResponse>>>;
export type ScenarioName = keyof typeof SCENARIOS;

export function isScenario(name: string): name is ScenarioName {
  return Object.hasOwn(SCENARIOS, name);
}

/** The full route table for a scenario: BASE with the scenario's overrides. */
export function responsesFor(name: ScenarioName): Record<RouteKey, MockResponse> {
  return { ...BASE, ...ownValue(SCENARIOS, name) };
}

/** Which route an /api request is, by method and path; undefined for anything else. */
export function matchRoute(method: string, pathname: string): RouteKey | undefined {
  return (Object.keys(ROUTES) as RouteKey[]).find((key) => {
    const route = routeFor(key);
    if (route.method !== method.toUpperCase()) return false;
    const pattern = new RegExp(`^${routePattern(key).replace(/:[^/]+/g, "[^/]+")}$`);
    return pattern.test(pathname);
  });
}

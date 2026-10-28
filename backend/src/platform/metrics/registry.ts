/**
 * ADR-0037 decision 1: the fixed metric registry. A metric that isn't listed here can't be
 * recorded, and every label key and value comes from a closed set (a fixed list of values, or a
 * check that the value can only ever be a bounded, non-personal token: a route pattern with
 * parameter names, not the concrete URL a client sent; a status class; a short, code-chosen name).
 * This is the one place that decides "safe to record" — `aggregator.ts` calls `validate` before it
 * ever touches a label, so a bug elsewhere (a stray query string, a user id) is refused here rather
 * than reaching Postgres. Names follow OpenTelemetry semantic conventions where one exists, so a
 * later exporter is a mapping, not a rewrite (ADR-0037 §4).
 *
 * `http.server.request.duration` is recorded by `requestMetrics.ts` (ADR-0037 build order #2), the
 * `satis.*` background metrics by their sources through `backgroundMetrics.ts` (#3). The rest of the
 * table is registered now so PR 4 slots into an already-fixed shape instead of inventing its own ad
 * hoc metric name.
 */
import { ownValue } from "@satisfactory-dash/shared";

export type MetricKind = "histogram" | "counter";

/** A label's check on the exact string it will be recorded with. */
export type LabelCheck = (value: string) => boolean;

export interface MetricDefinition {
  kind: MetricKind;
  /** Every label key this metric may carry. Recording a key outside this set is refused; every key
   *  listed here must be present on every recording (a metric never has an "optional" label — a
   *  missing one would silently widen the effective label set instead of failing loudly). */
  labels: Record<string, LabelCheck>;
}

export class UnknownMetricError extends Error {
  constructor(metric: string) {
    super(`Unknown metric "${metric}": it is not in the ADR-0037 registry.`);
    this.name = "UnknownMetricError";
  }
}

export class InvalidLabelError extends Error {
  constructor(metric: string, reason: string) {
    super(`Refusing to record "${metric}": ${reason}.`);
    this.name = "InvalidLabelError";
  }
}

const STATUS_CLASS = /^[1-5]xx$/;
export const isStatusClass: LabelCheck = (value) => STATUS_CLASS.test(value);

/** A short code-chosen token: never empty, never long enough to be a stray payload, and never
 *  containing characters a URL, an email or a free-text field would (whitespace, "?", "<", ">",
 *  "@"). Route patterns, query names and server public ids all satisfy this by construction. */
export const isBoundedToken =
  (maxLength: number): LabelCheck =>
  (value) =>
    value.length > 0 && value.length <= maxLength && !/[\s?<>@]/.test(value);

export const isOneOf =
  (...allowed: string[]): LabelCheck =>
  (value) =>
    allowed.includes(value);

/** ADR-0037 build step 3's closed sets. platform/ imports no module, so these are spelled out here: a
 *  new poller group, history table or alert kind is a registry change, and each source's tests check
 *  that every value it records is a member (the alert kinds against `RULE_KINDS` itself). */
const POLLER_GROUPS = ["power", "factory"];
const HISTORY_TABLES = ["power_samples", "item_samples", "building_transitions"];
/** The statuses an agent request is refused with (#514): agents/routes/agentApi.ts counts exactly these. */
/** ADR-0044 (348-2): why the push sender dropped a row without delivering it. */
export const PUSH_DROP_REASONS = ["not_member", "user_inactive", "opted_out", "endpoint_refused", "gone", "rejected", "expired", "unreadable", "push_disabled"] as const;
export const AGENT_REFUSED_STATUSES =["400", "401", "413", "415", "429"];
const ALERT_KINDS = ["power_outage", "fuse_trip", "stopped_machines", "server_unreachable", "production_below_target", "agent_offline"];

/** ADR-0037 build step 4's closed set: the static name of every query `timedQuery` (platform/db)
 *  runs, the only `query` label `db.client.operation.duration` takes. A new query is a registry
 *  change, and `timedQueryCallSites.test.ts` checks this list equals the names the code passes, so
 *  none goes unregistered and none lingers after its query is gone. */
export const QUERY_NAMES = [
  // agents
  "agents.claimOpenCommands",
  "agents.completeCommand",
  "agents.completeCommand.markExpired",
  "agents.completeCommand.update",
  "agents.consumeCode",
  "agents.countOpenCommands",
  "agents.deleteOpenCodes",
  "agents.endOpenCommandsOf",
  "agents.enrolledServerIds",
  "agents.expireStaleCommands",
  "agents.findActiveAgent",
  "agents.findOpenCodeServer",
  "agents.getAgentStatus",
  "agents.getCommandForServer",
  "agents.hasOpenCommands",
  "agents.insertCode",
  "agents.insertCommand",
  "agents.lockServer",
  "agents.purgeOldCommands",
  "agents.recentCommandsOfType",
  "agents.approvePairing",
  "agents.consumePairing",
  "agents.findOpenPairing",
  "agents.insertPairing",
  "agents.lockPairingBySecret",
  "agents.lockServerRow",
  "agents.peekPairingServer",
  "agents.sweepPairings",
  "agents.touchPairingPoll",
  "agents.revokeCredential",
  "agents.setAgentVersion",
  "agents.setGameConnection",
  "agents.touchAgent",
  "agents.upsertCredential",
  // alerts
  "alerts.api.clearMute",
  "alerts.api.countRules",
  "alerts.api.deleteDestination",
  "alerts.api.deleteRule",
  "alerts.api.enableDestination",
  "alerts.api.getMute",
  "alerts.api.getRule",
  "alerts.api.insertRule",
  "alerts.api.itemRuleExists",
  "alerts.api.listEvents",
  "alerts.api.listFiring",
  "alerts.api.listRules",
  "alerts.api.lockServer",
  "alerts.api.serverUuid",
  "alerts.api.setMute",
  "alerts.api.updateRule",
  "alerts.qualityByMonth",
  "alerts.firedByHour",
  "alerts.claimDue",
  "alerts.countRecentEvents",
  "alerts.deadForDestination",
  "alerts.deleteStates",
  "alerts.destinationSealed",
  "alerts.destinationSummary",
  "alerts.disableDestination",
  "alerts.enqueueDeliveries",
  "alerts.enqueuePush",
  "alerts.insertEvents",
  "alerts.listRules",
  "alerts.loadMutes",
  "alerts.loadStates",
  "alerts.markDeliveryDead",
  "alerts.markDeliverySent",
  "alerts.purge",
  "alerts.push.count",
  "alerts.push.delete",
  "alerts.push.deleteGone",
  "alerts.push.findByHash",
  "alerts.push.getOptIn",
  "alerts.push.getOwned",
  "alerts.push.getSealedOwned",
  "alerts.push.insert",
  "alerts.push.lockUser",
  "alerts.push.markSuccess",
  "alerts.push.recipientCheck",
  "alerts.push.removeOptIn",
  "alerts.push.setKeys",
  "alerts.push.setOptIn",
  "alerts.releaseDelivery",
  "alerts.rescheduleDelivery",
  "alerts.saveDestination",
  "alerts.seedPresetRules",
  "alerts.serverId",
  "alerts.upsertStates",
  // identity
  "identity.acceptedTermsVersion",
  "identity.addIdentity",
  "identity.authMethodsForUser",
  "identity.recordTermsAcceptance",
  "identity.consumeLoginAttempt",
  "identity.createLoginAttempt",
  "identity.countUsersCreatedLastHour",
  "identity.createSignupUser",
  "identity.createUser",
  "identity.displayNameTaken",
  "identity.takeSignupLock",
  "identity.deleteExpiredLoginAttempts",
  "identity.deleteExpiredSessions",
  "identity.findActiveSession",
  "identity.findUserByIdentity",
  "identity.getUserById",
  "identity.insertSession",
  "identity.revokeAllSessions",
  "identity.deleteAccount.count",
  "identity.deleteAccount.delete",
  "identity.deleteAccount.lockUser",
  "identity.deleteAccount.select",
  "identity.deleteAccount.sessionFresh",
  "identity.disableUser.dropCodes",
  "identity.disableUser.revokeAgents",
  "identity.revokeAllSessionsForUser",
  "identity.revokeSession",
  "identity.setUserEmail",
  "identity.setUserStatus",
  "identity.touchSession",
  "identity.updateDisplayName",
  // map
  "map.designations.delete",
  "map.designations.deleteMany",
  "map.designations.insert",
  "map.designations.insertRestoring",
  "map.designations.list",
  "map.designations.lockServer",
  "map.designations.readAll",
  "map.designations.reparentChildren",
  "map.designations.update",
  "map.upsertWorldLayerIfChanged",
  "map.world_layers",
  // servers
  "servers.accountDeletion.takeManagementLock",
  "servers.addMember",
  "servers.countConnections",
  "servers.countRecentSelfServeCreations",
  "servers.countSelfServeServers",
  "servers.create.takeAdvisoryLock",
  "servers.createConnection.exists",
  "servers.createConnection.insert",
  "servers.deleteConnection",
  "servers.dropOpenEnrollmentCodes",
  "servers.ensureServer",
  "servers.findServerByPublicId",
  "servers.getConnectionMeta",
  "servers.getMemberRole",
  "servers.importServers.takeManagementLock",
  "servers.insertSelfServeServer",
  "servers.listAgentServers",
  "servers.listConnectionMetas",
  "servers.listConnections",
  "servers.isSelfServeServer",
  "servers.listCreatedSelfServeServers",
  "servers.listOperatorAgentServers",
  "servers.listPendingSelfServeServers",
  "servers.listServersForUser",
  "servers.leaveServer",
  "servers.lockExpiredSelfServeServer",
  "servers.lockOwnedServers",
  "servers.lockOwnedServers.select",
  "servers.lockServerForPairing",
  "servers.lockServerForSelfServeOwner",
  "servers.lockServerByPublicId",
  "servers.removeMember",
  "servers.renameServer",
  "servers.saveConnection",
  "servers.selectConnection",
  "servers.selfServe.takeAdvisoryLock",
  "servers.setMemberRole",
  "servers.admin.listServers",
  "servers.softDeleteServer",
  "servers.softDeleteServer.deleteConnection",
  "servers.softDeleteServer.deleteHistory",
  "servers.softDeleteServer.deleteMembers",
  "servers.switchToAgentConnection",
  "servers.switchToAgentConnection.deleteConnection",
  "servers.switchToLocal.takeAdvisoryLock",
  "servers.switchToLocalKind",
  "servers.transferOwnership.audit",
  "servers.transferOwnership.lockServer",
  "servers.transferOwnership.lockTarget",
  "servers.transferOwnership.demoteOwner",
  "servers.transferOwnership.promoteTarget",
  "servers.updateConnection.rename",
  "servers.updateConnection.update",
  "servers.upsertConfiguredServer",
  // telemetry
  "telemetry.history.items",
  "telemetry.history.power",
  "telemetry.history.setStatementTimeout",
  "telemetry.history.topItems",
  "telemetry.history.transitions",
  "telemetry.insertItemSamples",
  "telemetry.insertPowerSamples",
  "telemetry.insertTransitions",
  "telemetry.latestSnapshots.load",
  "telemetry.latestSnapshots.upsert",
  "telemetry.purge",
  "telemetry.rollupItemHours",
  "telemetry.rollupItemMinutes",
  "telemetry.rollupPowerHours",
  "telemetry.rollupPowerMinutes",
  // platform
  "audit.listRecentAuditEvents",
  "audit.purgeExpiredAuditEvents",
  "audit.recordAuditEvent",
  "metrics.addSeriesDelta",
  "metrics.counterHourly",
  "metrics.counterTotals",
  "metrics.histogramBuckets",
  "metrics.histogramHourly",
  "metrics.insertDeliverySnapshot",
  "metrics.latestDeliverySnapshot",
  "metrics.mergeBucketCountsInDb",
  "metrics.pruneDeliverySnapshots",
  "metrics.purgeExpiredSeries",
  "retention.expiredEnrollmentCodes",
  "retention.finishedOutbox",
  "retention.passedMutes",
  "retention.topTableSizes",
] as const;

export type QueryName = (typeof QUERY_NAMES)[number];

/** ADR-0037 §1's table, in order. */
export const METRIC_REGISTRY: Readonly<Record<string, MetricDefinition>> = Object.freeze({
  "http.server.request.duration": {
    kind: "histogram",
    labels: { route: isBoundedToken(200), status_class: isStatusClass },
  },
  "http.server.upstream.duration": {
    kind: "histogram",
    labels: { api: isOneOf("vanilla", "frm") },
  },
  "db.client.operation.duration": {
    kind: "histogram",
    labels: { query: isOneOf(...QUERY_NAMES) },
  },
  // `server` is the server's public id; `group` the poller's endpoint group.
  "satis.poller.cycle.duration": {
    kind: "histogram",
    labels: { server: isBoundedToken(64), group: isOneOf(...POLLER_GROUPS) },
  },
  "satis.poller.lag": {
    kind: "histogram",
    labels: { server: isBoundedToken(64), group: isOneOf(...POLLER_GROUPS) },
  },
  // "Apparent" lag: received-at minus the agent's own `observedAt`, so the agent's clock skew is
  // included; clamped at 0 by the recorder, never negative.
  "satis.agent.ingest.lag": {
    kind: "histogram",
    labels: { server: isBoundedToken(64) },
  },
  // #514 (ADR-0045 O4): refused agent requests, by the server's public id ("unknown" before the
  // credential is checked) and the HTTP status, so the operator sees which server misbehaves.
  "satis.agent.refused": {
    kind: "counter",
    labels: { server: isBoundedToken(64), status: isOneOf(...AGENT_REFUSED_STATUSES) },
  },
  // #528 (ADR-0046 C8): new-account refusals. `signup_busy` = the process-wide hourly cap; `network_limit` = one
  // network's own daily share. A sustained rate of either is a sign-up flood the operator should look at.
  "satis.signup.refused": {
    kind: "counter",
    labels: { reason: isOneOf("signup_busy", "network_limit") },
  },
  // #526 (ADR-0046 C4): self-serve servers the pending sweep removed because they never enrolled within the TTL. A sustained
  // rate is accounts creating servers they never connect (M3's residual); `list-servers` names them.
  // ADR-0051 section 1: device-code pairing, by event. `expired` counts pairings deleted by the sweep that were never
  // collected (never approved, or approved and never polled for). A high expired-to-started ratio is a setup that fails.
  "satis.pairing.events": {
    kind: "counter",
    labels: { event: isOneOf("started", "approved", "expired") },
  },
  "satis.servers.pending_swept": {
    kind: "counter",
    labels: {},
  },
  "satis.history.rows_written": {
    kind: "counter",
    labels: { table: isOneOf(...HISTORY_TABLES) },
  },
  // #515 (ADR-0045 M11): rows a per-server history cap kept out of the database; `server` is the public id.
  "satis.history.rows_dropped": {
    kind: "counter",
    labels: { server: isBoundedToken(64), table: isOneOf(...HISTORY_TABLES) },
  },
  "satis.alerts.evaluation.duration": {
    kind: "histogram",
    labels: {},
  },
  "satis.alerts.fire.lag": {
    kind: "histogram",
    labels: { kind: isOneOf(...ALERT_KINDS) },
  },
  // #515 (ADR-0045 M12): alert events over a server's hourly cap, not stored or sent; `server` is the public id.
  "satis.alerts.events_dropped": {
    kind: "counter",
    labels: { server: isBoundedToken(64) },
  },
  // ADR-0044 (348-2): push rows the sender gave up on without a delivery, by reason (the send-time recipient recheck,
  // the endpoint allowlist recheck, a gone subscription, a refusal, expiry); `server` is the public id.
  "satis.alerts.push.dropped": {
    kind: "counter",
    labels: { server: isBoundedToken(64), reason: isOneOf(...PUSH_DROP_REASONS) },
  },
});

/** Throws `UnknownMetricError` or `InvalidLabelError`; returns the definition otherwise, so a
 *  caller that already looked it up (the aggregator) doesn't look it up twice. */
export function validateRecording(
  metric: string,
  kind: MetricKind,
  labels: Readonly<Record<string, string>>,
): MetricDefinition {
  // ownValue / Object.hasOwn, not `METRIC_REGISTRY[metric]` / `in`: METRIC_REGISTRY (and every
  // `labels` object below) is a plain object, so a metric or label key that collides with something
  // Object.prototype already has (`toString`, `constructor`, `__proto__`, ...) is truthy / "in"
  // via the prototype chain even though it was never registered. A metric string picked that way
  // must still be refused as unknown, and a label key picked that way must still be refused as
  // undeclared — not silently treated as present with no check run against its value at all.
  // (The lint rule safe-lookup/no-table-index enforces this, #368.)
  const definition = ownValue(METRIC_REGISTRY, metric);
  if (definition === undefined) {
    throw new UnknownMetricError(metric);
  }
  if (definition.kind !== kind) {
    throw new InvalidLabelError(metric, `recorded as a ${kind}, but the registry declares it a ${definition.kind}`);
  }
  const declaredKeys = Object.keys(definition.labels);
  const givenKeys = Object.keys(labels);
  for (const key of givenKeys) {
    if (!Object.hasOwn(definition.labels, key)) {
      throw new InvalidLabelError(metric, `label "${key}" is not declared for this metric`);
    }
  }
  for (const key of declaredKeys) {
    const value = labels[key];
    if (value === undefined) {
      throw new InvalidLabelError(metric, `label "${key}" is required but was not given`);
    }
    if (!definition.labels[key](value)) {
      throw new InvalidLabelError(metric, `label "${key}" value "${value}" is outside its allowed set`);
    }
  }
  return definition;
}

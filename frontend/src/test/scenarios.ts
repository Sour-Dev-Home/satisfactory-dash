import { endpoints } from "@satisfactory-dash/shared";
import {
  deleteServerDone,
  errorImportRequired,
  errorLanRequiresCertPinning,
  errorLoginFailed,
  errorRateLimited,
  errorUnknownCode,
  errorUpstreamAuthRejected,
  errorUpstreamUnreachable,
  errorWithDetail,
  factoryEmpty,
  factoryMixed,
  factoryUnknownItem,
  healthOk,
  historyPower24h,
  managedServersAllStates,
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
  serverConnectionOk,
  serversMultiple,
  serversNone,
  serversSingle,
  sessionAnonymous,
  sessionAuthenticated,
  settingsEditable,
  settingsPending,
  settingsReadOnly,
  statusNoGame,
  statusPaused,
  statusRunning,
  statusSlow,
  statusStale,
  testConnectionApiUnauthorized,
  testConnectionPassed,
} from "@satisfactory-dash/shared/fixtures";

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
  settings: endpoints.settings.get,
  setAutoPause: endpoints.settings.setAutoPause,
  // ADR-0030, operator only.
  managedServers: endpoints.serverManagement.list,
  testConnection: endpoints.serverManagement.testConnection,
  testSaved: endpoints.serverManagement.testSaved,
  createServer: endpoints.serverManagement.create,
  updateServer: endpoints.serverManagement.update,
  removeServer: endpoints.serverManagement.remove,
  // ADR-0027 stored history (the query string doesn't change the route).
  historyPower: endpoints.history.power,
} as const;
export type RouteKey = keyof typeof ROUTES;

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const fail = (status: number, body: unknown): MockResponse => ({ status, body });

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
  settings: ok(settingsEditable),
  setAutoPause: ok(settingsEditable),
  managedServers: ok(managedServersAllStates),
  testConnection: ok(testConnectionPassed),
  testSaved: ok(testConnectionPassed),
  createServer: ok(serverConnectionOk),
  updateServer: ok(serverConnectionOk),
  removeServer: ok(deleteServerDone),
  historyPower: ok(historyPower24h),
};

/** The operator with one server: the Servers tab shows (ADR-0030). */
const operatorSingle = ok({ ...serversSingle, canManageServers: true });

const upstreamDown = (error: unknown): Partial<Record<RouteKey, MockResponse>> => ({
  status: fail(502, error),
  power: fail(502, error),
  powerHistory: fail(502, error),
  factory: fail(502, error),
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

/** Every state the visual checks cover (ADR-0016 item 5). Keys are URL-safe. */
export const SCENARIOS = {
  default: {},
  "loading": { session: { status: 200, delay: "never" } },
  "login": { session: ok(sessionAnonymous) },
  // A backend with Google sign-in on (ADR-0025): the button shows above the password form.
  "login-google": { session: ok({ ...sessionAnonymous, signInMethods: ["password", "google"] }) },
  // The backend's redirect after a failed Google sign-in (the text is fixed, never the query).
  "login-google-error": { session: ok({ ...sessionAnonymous, signInMethods: ["password", "google"] }) },
  "login-failed": { session: ok(sessionAnonymous), login: fail(401, errorLoginFailed) },
  "login-rate-limited": { session: ok(sessionAnonymous), login: fail(429, errorRateLimited) },
  "no-servers": { servers: ok(serversNone) },
  "server-picker": { servers: ok(serversMultiple) },
  "paused": { status: ok(statusPaused) },
  "stale": { status: ok(statusStale), power: ok(powerStale) },
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
  "settings-read-only": { settings: ok(settingsReadOnly) },
  "settings-pending": { settings: ok(settingsPending) },
  "upstream-unreachable": upstreamDown(errorUpstreamUnreachable),
  "upstream-auth-rejected": upstreamDown(errorUpstreamAuthRejected),
  "upstream-invalid": upstreamDown(errorWithDetail),
  "unknown-error-code": upstreamDown(errorUnknownCode),
  "backend-unreachable": { session: { status: 502, text: "Bad Gateway" } },
  "contract-drift": { status: ok({ ...statusRunning, data: { ...statusRunning.data, gamePaused: "no" } }) },
  // Server management (ADR-0030), at /app/servers: one row per stored state (ok, unreadable, refused).
  "servers-manage": { servers: operatorSingle },
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
} satisfies Record<string, Partial<Record<RouteKey, MockResponse>>>;
export type ScenarioName = keyof typeof SCENARIOS;

export function isScenario(name: string): name is ScenarioName {
  return Object.hasOwn(SCENARIOS, name);
}

/** The full route table for a scenario: BASE with the scenario's overrides. */
export function responsesFor(name: ScenarioName): Record<RouteKey, MockResponse> {
  return { ...BASE, ...SCENARIOS[name] };
}

/** Which route an /api request is, by method and path; undefined for anything else. */
export function matchRoute(method: string, pathname: string): RouteKey | undefined {
  return (Object.keys(ROUTES) as RouteKey[]).find((key) => {
    const route = ROUTES[key];
    if (route.method !== method.toUpperCase()) return false;
    const pattern = new RegExp(`^${route.route.replace(/:[^/]+/g, "[^/]+")}$`);
    return pattern.test(pathname);
  });
}

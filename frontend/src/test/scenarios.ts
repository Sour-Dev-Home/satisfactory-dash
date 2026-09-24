import { endpoints } from "@satisfactory-dash/shared";
import {
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
  servers: endpoints.servers,
  status: endpoints.status,
  power: endpoints.power,
  powerHistory: endpoints.powerHistory,
  factory: endpoints.factory,
  settings: endpoints.settings.get,
  setAutoPause: endpoints.settings.setAutoPause,
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
  servers: ok(serversSingle),
  status: ok(statusRunning),
  power: ok(powerOk),
  powerHistory: ok(powerHistoryNormal),
  factory: ok(factoryMixed),
  settings: ok(settingsEditable),
  setAutoPause: ok(settingsEditable),
};

const upstreamDown = (error: unknown): Partial<Record<RouteKey, MockResponse>> => ({
  status: fail(502, error),
  power: fail(502, error),
  powerHistory: fail(502, error),
  factory: fail(502, error),
  settings: fail(502, error),
});

/** Every state the visual checks cover (ADR-0016 item 5). Keys are URL-safe. */
export const SCENARIOS = {
  default: {},
  "loading": { session: { status: 200, delay: "never" } },
  "login": { session: ok(sessionAnonymous) },
  "login-failed": { session: ok(sessionAnonymous), login: fail(401, errorLoginFailed) },
  "login-rate-limited": { session: ok(sessionAnonymous), login: fail(429, errorRateLimited) },
  "no-servers": { servers: ok(serversNone) },
  "server-picker": { servers: ok(serversMultiple) },
  "paused": { status: ok(statusPaused) },
  "stale": { status: ok(statusStale), power: ok(powerStale) },
  "slow-tick": { status: ok(statusSlow) },
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

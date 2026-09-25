import { http, HttpResponse } from "msw";
import { endpoints } from "@satisfactory-dash/shared";
import {
  factoryMixed,
  healthOk,
  playersUnavailable,
  powerHistoryNormal,
  powerOk,
  serversSingle,
  sessionAnonymous,
  sessionAuthenticated,
  settingsEditable,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";

// Default MSW handlers: the happy path for a signed-in operator with one server. Built only
// from the shared fixtures. Tests override individual routes with server.use(...).
// MSW path params use the same ":serverId" syntax as the Express routes in endpoints.ts.
export const handlers = [
  http.get(endpoints.health.route, () => HttpResponse.json(healthOk)),
  http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAuthenticated)),
  http.post(endpoints.auth.login.route, () => HttpResponse.json(sessionAuthenticated)),
  http.post(endpoints.auth.logout.route, () => HttpResponse.json(sessionAnonymous)),
  http.post(endpoints.auth.logoutAll.route, () => HttpResponse.json(sessionAnonymous)),
  http.get(endpoints.servers.route, () => HttpResponse.json(serversSingle)),
  http.get(endpoints.status.route, () => HttpResponse.json(statusRunning)),
  // No FicsitRemoteMonitoring by default (ADR-0029): tests that care about names override this.
  http.get(endpoints.players.route, () => HttpResponse.json(playersUnavailable)),
  http.get(endpoints.power.route, () => HttpResponse.json(powerOk)),
  http.get(endpoints.powerHistory.route, () => HttpResponse.json(powerHistoryNormal)),
  http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)),
  http.get(endpoints.settings.get.route, () => HttpResponse.json(settingsEditable)),
  http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(settingsEditable)),
];

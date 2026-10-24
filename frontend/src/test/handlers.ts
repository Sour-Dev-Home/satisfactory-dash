import { http, HttpResponse } from "msw";
import { endpoints } from "@satisfactory-dash/shared";
import {
  agentEnrollmentCodeResponse,
  agentRevokeResponse,
  agentStatusNotEnrolled,
  alertDestinationsConfigured,
  alertEventsLastPage,
  alertRulesList,
  alertStatusQuiet,
  bottlenecksBeltLevel,
  deleteServerDone,
  factoryMixed,
  productionGraphTwoSites,
  railsWorldResponse,
  resourceNodesWorldResponse,
  healthOk,
  historyItems7d,
  historyPower24h,
  historyTransitions24h,
  managedServersAllStates,
  playersUnavailable,
  powerHistoryNormal,
  powerOk,
  pushConfigDisabled,
  pushOptInOff,
  pushSubscribeResponse,
  pushUnsubscribeResponse,
  alertSendTestOk,
  renameAgentServerResponse,
  serverConnectionOk,
  serversSingle,
  sessionAnonymous,
  sessionAuthenticated,
  settingsEditable,
  statusRunning,
  testConnectionPassed,
} from "@satisfactory-dash/shared/fixtures";
import { accountDeleted, serverLeft } from "./accountMocks";
import { createdAgentServer } from "./selfServeMocks";

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
  // ADR-0027 stored history: one fixture whatever `?range=` asks (tests that care override it).
  http.get(endpoints.history.power.route, () => HttpResponse.json(historyPower24h)),
  // The Factory page's history (ADR-0027 PR 8b), queried whenever FactoryView renders.
  http.get(endpoints.history.items.route, () => HttpResponse.json(historyItems7d)),
  http.get(endpoints.history.transitions.route, () => HttpResponse.json(historyTransitions24h)),
  http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)),
  // ADR-0048 (#349): the Factory page's Bottlenecks section.
  http.get(endpoints.bottlenecks.route, () => HttpResponse.json(bottlenecksBeltLevel)),
  // ADR-0050: the Planner page.
  http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphTwoSites)),
  // ADR-0038 M5: one handler per world layer (the endpoint's `:layer` is filled in).
  http.get(endpoints.map.worldLayer.route.replace(":layer", "rails"), () => HttpResponse.json(railsWorldResponse)),
  http.get(endpoints.map.worldLayer.route.replace(":layer", "resourceNodes"), () => HttpResponse.json(resourceNodesWorldResponse)),
  http.get(endpoints.settings.get.route, () => HttpResponse.json(settingsEditable)),
  http.put(endpoints.settings.setAutoPause.route, () => HttpResponse.json(settingsEditable)),
  // ADR-0030, operator only (the default server list doesn't offer it; tests opt in).
  http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(managedServersAllStates)),
  http.post(endpoints.serverManagement.testConnection.route, () => HttpResponse.json(testConnectionPassed)),
  http.post(endpoints.serverManagement.testSaved.route, () => HttpResponse.json(testConnectionPassed)),
  http.post(endpoints.serverManagement.create.route, () => HttpResponse.json(serverConnectionOk)),
  http.patch(endpoints.serverManagement.update.route, () => HttpResponse.json(serverConnectionOk)),
  http.delete(endpoints.serverManagement.remove.route, () => HttpResponse.json(deleteServerDone)),
  // ADR-0046: any signed-in user adds a server of their own.
  http.post(endpoints.selfServe.createAgentServer.route, () => HttpResponse.json(createdAgentServer, { status: 201 })),
  // ADR-0031: an agent server's two edits.
  http.patch(endpoints.serverManagement.renameAgent.route, () => HttpResponse.json(renameAgentServerResponse)),
  http.post(endpoints.serverManagement.switchToLocal.route, () => HttpResponse.json(serverConnectionOk)),
  // Alerts (ADR-0027 PR 9). The header bell reads the status on every page: quiet by default, so
  // no badge shows unless a test asks for one.
  http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusQuiet)),
  http.get(endpoints.alerts.rules.list.route, () => HttpResponse.json(alertRulesList)),
  http.get(endpoints.alerts.destinations.get.route, () => HttpResponse.json(alertDestinationsConfigured)),
  http.get(endpoints.alerts.events.route, () => HttpResponse.json(alertEventsLastPage)),
  // Web push (ADR-0044): off on the backend by default, so the Alerts panel only explains it.
  http.get(endpoints.push.config.route, () => HttpResponse.json(pushConfigDisabled)),
  http.get(endpoints.push.optIn.get.route, () => HttpResponse.json(pushOptInOff)),
  http.put(endpoints.push.optIn.put.route, () => HttpResponse.json({ optedIn: true })),
  http.post(endpoints.push.subscribe.route, () => HttpResponse.json(pushSubscribeResponse, { status: 201 })),
  http.delete(endpoints.push.unsubscribe.route, () => HttpResponse.json(pushUnsubscribeResponse)),
  http.post(endpoints.push.test.route, () => HttpResponse.json(alertSendTestOk)),
  // The game PC agent (ADR-0031 PR 7): a directly reached server with none enrolled.
  http.get(endpoints.agent.status.route, () => HttpResponse.json(agentStatusNotEnrolled)),
  http.post(endpoints.agent.enrollmentCode.route, () => HttpResponse.json(agentEnrollmentCodeResponse, { status: 201 })),
  http.delete(endpoints.agent.revoke.route, () => HttpResponse.json(agentRevokeResponse)),
  // ADR-0047: deleting your account and leaving a server both succeed by default; tests override the refusals.
  http.delete(endpoints.account.remove.route, () => HttpResponse.json(accountDeleted)),
  http.post(endpoints.members.leave.route, () => HttpResponse.json(serverLeft)),
];

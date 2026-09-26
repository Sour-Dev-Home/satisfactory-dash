import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  alertDestinationsNone,
  alertDestinationsWebhookGone,
  alertEventsEmpty,
  alertEventsLastPage,
  alertEventsPage,
  alertRulesList,
  alertStatusShadowMutedFiring,
  errorUpstreamUnreachable,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AlertsView } from "./AlertsView";

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <AlertsView />
    </ServerContext>,
  );
}

describe("AlertsView", () => {
  it("says delivery is off and muted, and lists what's firing", async () => {
    server.use(http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusShadowMutedFiring)));
    renderView();
    expect(await screen.findByText(/Delivery is off \(shadow week\)/)).toBeInTheDocument();
    expect(screen.getByText(/Muted until/)).toBeInTheDocument();
    const firing = screen.getByRole("list", { name: "Firing now" });
    expect(within(firing).getAllByRole("listitem")).toHaveLength(alertStatusShadowMutedFiring.firing.length);
    expect(within(firing).getByText(/Stopped machines: Machines/)).toBeInTheDocument();
  });

  it("names the item of a firing production alert from its rule", async () => {
    const target = alertRulesList.rules.find((r) => r.kind === "production_below_target");
    expect(target).toBeDefined();
    const alert = { ruleId: target!.id, kind: "production_below_target", subject: "item", severity: "warning", since: "2026-09-26T09:00:00.000Z" };
    server.use(
      http.get(endpoints.alerts.status.route, () => HttpResponse.json({ ...alertStatusShadowMutedFiring, firing: [alert] })),
    );
    renderView();
    const firing = await screen.findByRole("list", { name: "Firing now" });
    expect(await within(firing).findByText(/Production below target: Iron Plate/)).toBeInTheDocument();
  });

  it("says nothing is firing, and shows the configured webhook by its last 4 characters only", async () => {
    renderView();
    expect(await screen.findByText("Nothing is firing.")).toBeInTheDocument();
    expect(await screen.findByText(/Webhook ending in/)).toHaveTextContent("…aB3d");
    expect(screen.queryByText(/Delivery is off/)).not.toBeInTheDocument();
  });

  it("explains a webhook Discord deleted", async () => {
    server.use(http.get(endpoints.alerts.destinations.get.route, () => HttpResponse.json(alertDestinationsWebhookGone)));
    renderView();
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    expect(screen.getByText("off")).toBeInTheDocument();
  });

  it("says when no webhook is set and the log is empty", async () => {
    server.use(
      http.get(endpoints.alerts.destinations.get.route, () => HttpResponse.json(alertDestinationsNone)),
      http.get(endpoints.alerts.events.route, () => HttpResponse.json(alertEventsEmpty)),
    );
    renderView();
    expect(await screen.findByText(/No Discord webhook is set/)).toBeInTheDocument();
    expect(await screen.findByText("No alerts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /older/ })).not.toBeInTheDocument();
  });

  it("pages back through the log with the backend's nextBefore", async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(endpoints.alerts.events.route, ({ request }) => {
        const before = new URL(request.url).searchParams.get("before");
        asked.push(before);
        return HttpResponse.json(before === null ? alertEventsPage : alertEventsLastPage);
      }),
    );
    renderView();
    const log = await screen.findByRole("list", { name: "Alert log, newest first" });
    expect(within(log).getAllByRole("listitem")).toHaveLength(alertEventsPage.events.length);
    fireEvent.click(screen.getByRole("button", { name: "Show older alerts" }));
    const total = alertEventsPage.events.length + alertEventsLastPage.events.length;
    await waitFor(() => expect(within(log).getAllByRole("listitem")).toHaveLength(total));
    expect(asked).toEqual([null, alertEventsPage.nextBefore]);
    // The last page has no nextBefore, so there's nothing older to offer.
    expect(screen.queryByRole("button", { name: /older/ })).not.toBeInTheDocument();
  });

  it("keeps the rest of the page when one part fails, with a retry for that part", async () => {
    server.use(http.get(endpoints.alerts.events.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    renderView();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(await screen.findByText("Nothing is firing.")).toBeInTheDocument();
  });
});

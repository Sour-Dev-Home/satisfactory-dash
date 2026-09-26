import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
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
import { AlertsMenu } from "./AlertsMenu";

function renderMenu() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <AlertsMenu onNavigate={() => {}} />
      </ServerContext>
    </MemoryRouter>,
  );
}

const section = (name: string) => screen.getByRole("region", { name });

describe("AlertsMenu", () => {
  it("says delivery is off and muted, and lists what's firing first", async () => {
    server.use(http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusShadowMutedFiring)));
    renderMenu();
    expect(await screen.findByText(/Delivery is off \(shadow week\)/)).toBeInTheDocument();
    expect(screen.getByText(/Muted until/)).toBeInTheDocument();
    const firing = section("Firing now");
    expect(within(firing).getAllByRole("button")).toHaveLength(alertStatusShadowMutedFiring.firing.length);
    expect(within(firing).getByRole("button", { name: /Stopped machines/ })).toBeInTheDocument();
  });

  it("names the item of a firing production alert from its rule", async () => {
    const target = alertRulesList.rules.find((r) => r.kind === "production_below_target")!;
    const alert = { ruleId: target.id, kind: "production_below_target", subject: "item", severity: "warning", since: "2026-09-26T09:00:00.000Z" };
    server.use(
      http.get(endpoints.alerts.status.route, () => HttpResponse.json({ ...alertStatusShadowMutedFiring, firing: [alert] })),
    );
    renderMenu();
    expect(await screen.findByRole("button", { name: /Production below target: Iron Plate/ })).toBeInTheDocument();
  });

  it("expands an alert in place to show its detail, and collapses it again", async () => {
    server.use(http.get(endpoints.alerts.events.route, () => HttpResponse.json(alertEventsPage)));
    renderMenu();
    await screen.findByText("Nothing is firing.");
    const recent = section("Recent");
    const [first] = await within(recent).findAllByRole("button", { expanded: false });
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(first.getAttribute("aria-controls")!);
    expect(detail).toHaveTextContent(/Iron Plate: 118.4 per min against a target of 120 per min/);
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(first.getAttribute("aria-controls")!)).toBeNull();
  });

  it("marks resolved alerts as resolved, whatever their severity", async () => {
    server.use(http.get(endpoints.alerts.events.route, () => HttpResponse.json(alertEventsPage)));
    renderMenu();
    const recent = await screen.findByRole("region", { name: "Recent" });
    const resolved = alertEventsPage.events.filter((e) => e.transition === "resolved").length;
    await waitFor(() => expect(within(recent).getAllByRole("button", { name: /^Resolved / })).toHaveLength(resolved));
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
    renderMenu();
    await screen.findByRole("button", { name: "Show older alerts" });
    fireEvent.click(screen.getByRole("button", { name: "Show older alerts" }));
    const total = alertEventsPage.events.length + alertEventsLastPage.events.length;
    await waitFor(() => expect(within(section("Recent")).getAllByRole("listitem")).toHaveLength(total));
    expect(asked).toEqual([null, alertEventsPage.nextBefore]);
    expect(screen.queryByRole("button", { name: /older/ })).not.toBeInTheDocument();
  });

  it("says when there are no alerts yet", async () => {
    server.use(http.get(endpoints.alerts.events.route, () => HttpResponse.json(alertEventsEmpty)));
    renderMenu();
    expect(await screen.findByText("No alerts yet.")).toBeInTheDocument();
  });

  it("keeps what's firing when the log fails, with a retry for the log", async () => {
    server.use(http.get(endpoints.alerts.events.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    renderMenu();
    expect(await within(section("Recent")).findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Nothing is firing.")).toBeInTheDocument();
  });
});

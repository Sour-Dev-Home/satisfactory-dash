import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { alertStatusShadowMutedFiring, errorForbidden, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AlertsBell } from "./AlertsBell";

function renderBell() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <AlertsBell />
      </ServerContext>
    </MemoryRouter>,
  );
}

const statusCalls = () => {
  let calls = 0;
  return {
    count: () => calls,
    handler: (body: Record<string, unknown>, status = 200) =>
      http.get(endpoints.alerts.status.route, () => {
        calls++;
        return HttpResponse.json(body, { status });
      }),
  };
};

describe("AlertsBell", () => {
  it("links to the Alerts page, with no badge while nothing is firing", async () => {
    renderBell();
    const link = await screen.findByRole("link", { name: "Alerts" });
    expect(link).toHaveAttribute("href", "/app/alerts");
    expect(screen.queryByTestId("alerts-badge")).not.toBeInTheDocument();
  });

  it("counts the selected server's firing alerts, in the badge and the link's name", async () => {
    server.use(http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusShadowMutedFiring)));
    renderBell();
    const firing = alertStatusShadowMutedFiring.firing.length;
    expect(await screen.findByRole("link", { name: `Alerts, ${firing} firing` })).toBeInTheDocument();
    expect(screen.getByTestId("alerts-badge")).toHaveTextContent(String(firing));
  });

  it("caps the badge at 99+", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...alertStatusShadowMutedFiring.firing[0], subject: `circuit:${i}` }));
    server.use(
      http.get(endpoints.alerts.status.route, () => HttpResponse.json({ ...alertStatusShadowMutedFiring, firing: many })),
    );
    renderBell();
    expect(await screen.findByTestId("alerts-badge")).toHaveTextContent("99+");
    expect(screen.getByRole("link", { name: "Alerts, 120 firing" })).toBeInTheDocument();
  });

  it("stays a plain bell when the status is refused, and never shows an error in the header", async () => {
    const calls = statusCalls();
    server.use(calls.handler(errorForbidden, 403));
    renderBell();
    await waitFor(() => expect(calls.count()).toBeGreaterThan(0));
    expect(screen.getByRole("link", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.queryByTestId("alerts-badge")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays a plain bell when the status doesn't match the contract", async () => {
    const calls = statusCalls();
    server.use(calls.handler({ firing: "lots" }));
    renderBell();
    await waitFor(() => expect(calls.count()).toBeGreaterThan(0));
    expect(screen.getByRole("link", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { alertEventsLastPage, alertStatusShadowMutedFiring, errorForbidden, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AlertsBell } from "./AlertsBell";

function renderBell() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <p>
          <button type="button">Elsewhere</button>
        </p>
        <AlertsBell />
      </ServerContext>
    </MemoryRouter>,
  );
}

const bell = (name: string | RegExp = /^Alerts/) => screen.getByRole("button", { name });

function countCalls(route: string) {
  let calls = 0;
  server.use(
    http.get(route, () => {
      calls++;
      return HttpResponse.json(alertEventsLastPage);
    }),
  );
  return () => calls;
}

describe("AlertsBell", () => {
  it("is a closed disclosure with no badge while nothing is firing", async () => {
    renderBell();
    await waitFor(() => expect(bell("Alerts")).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByTestId("alerts-badge")).not.toBeInTheDocument();
  });

  it("counts the selected server's firing alerts, in the badge and the bell's name", async () => {
    server.use(http.get(endpoints.alerts.status.route, () => HttpResponse.json(alertStatusShadowMutedFiring)));
    renderBell();
    const firing = alertStatusShadowMutedFiring.firing.length;
    expect(await screen.findByRole("button", { name: `Alerts, ${firing} firing` })).toBeInTheDocument();
    expect(screen.getByTestId("alerts-badge")).toHaveTextContent(String(firing));
  });

  it("caps the badge at 99+", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...alertStatusShadowMutedFiring.firing[0], subject: `circuit:${i}` }));
    server.use(
      http.get(endpoints.alerts.status.route, () => HttpResponse.json({ ...alertStatusShadowMutedFiring, firing: many })),
    );
    renderBell();
    expect(await screen.findByTestId("alerts-badge")).toHaveTextContent("99+");
  });

  it("stays a plain bell when the status is refused, with no error in the header", async () => {
    server.use(http.get(endpoints.alerts.status.route, () => HttpResponse.json(errorForbidden, { status: 403 })));
    renderBell();
    await waitFor(() => expect(bell("Alerts")).toBeInTheDocument());
    expect(screen.queryByTestId("alerts-badge")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads the alert log only once the dropdown opens (the badge's status is the only background poll)", async () => {
    const logCalls = countCalls(endpoints.alerts.events.route);
    renderBell();
    await waitFor(() => expect(bell("Alerts")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(logCalls()).toBe(0);
    fireEvent.click(bell());
    expect(bell()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(logCalls()).toBe(1));
  });

  it("closes on Escape and gives focus back to the bell", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Alerts/ }));
    const link = await screen.findByRole("link", { name: "Manage alerts" });
    link.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell()).toHaveAttribute("aria-expanded", "false");
    expect(bell()).toHaveFocus();
    expect(screen.queryByRole("link", { name: "Manage alerts" })).not.toBeInTheDocument();
  });

  it("closes on a click outside, and when focus tabs out of it", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Alerts/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(bell()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(bell());
    const link = await screen.findByRole("link", { name: "Manage alerts" });
    fireEvent.blur(link, { relatedTarget: screen.getByRole("button", { name: "Elsewhere" }) });
    expect(bell()).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open while focus moves inside it", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Alerts/ }));
    const link = await screen.findByRole("link", { name: "Manage alerts" });
    fireEvent.blur(bell(), { relatedTarget: link });
    expect(bell()).toHaveAttribute("aria-expanded", "true");
  });

  it("links to the alert settings, and closes when it's followed", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Alerts/ }));
    const link = await screen.findByRole("link", { name: "Manage alerts" });
    expect(link).toHaveAttribute("href", "/app/settings#alerts");
    fireEvent.click(link);
    expect(bell()).toHaveAttribute("aria-expanded", "false");
  });

  it("controls the dropdown it opens", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Alerts/ }));
    const panel = document.getElementById(bell().getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
  });
});

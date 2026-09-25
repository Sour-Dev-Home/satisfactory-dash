import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorSessionRequired, sessionAnonymous } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { SESSION_KEY } from "./api/queries";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

// Independent (test-hunter) pass: the Sign out action in the app-level fallback.
const gate = vi.hoisted(() => ({ broken: true }));
vi.mock("./auth/AuthGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("./auth/AuthGate")>();
  return {
    AuthGate: ({ children }: { children: ReactNode }) => {
      if (gate.broken) throw new Error("auth gate bug");
      return <real.AuthGate>{children}</real.AuthGate>;
    },
  };
});

beforeEach(() => {
  gate.broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const dashboardAlert = () => screen.findByRole("alert", { name: "The dashboard error" });

describe("App-level fallback Sign out", () => {
  it("signs out locally when Sign out succeeds from the fallback", async () => {
    let calls = 0;
    server.use(
      http.post(endpoints.auth.logout.route, () => {
        calls++;
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    const { client } = renderWithClient(<App />);
    const alert = await dashboardAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() =>
      expect(client.getQueryData(SESSION_KEY)).toMatchObject({ authenticated: false }),
    );
  });

  it("with the crash fixed, Try again after Sign out shows the sign-in screen", async () => {
    renderWithClient(<App />);
    const alert = await dashboardAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(within(alert).getByRole("button", { name: "Sign out" })).toBeEnabled());
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    gate.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Server status" })).not.toBeInTheDocument();
  });

  it("a crash before sign-in: Sign out answered with 401 does not break the fallback", async () => {
    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)),
      http.post(endpoints.auth.logout.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })),
    );
    renderWithClient(<App />);
    const alert = await dashboardAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(within(alert).getByRole("button", { name: "Sign out" })).toBeEnabled());
    expect(screen.getByRole("alert", { name: "The dashboard error" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeInTheDocument();
  });

  it("a failed Sign out shows its error inside the fallback and Try again still works", async () => {
    server.use(http.post(endpoints.auth.logout.route, () => HttpResponse.error()));
    renderWithClient(<App />);
    const alert = await dashboardAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Sign out" }));
    expect(await within(alert).findByText("Couldn't reach the dashboard backend.")).toBeInTheDocument();
    // The outer notice keeps its accessible name, so its locator stays unique.
    expect(screen.getAllByRole("alert", { name: "The dashboard error" })).toHaveLength(1);

    gate.broken = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Server status" })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't reach the dashboard backend.")).not.toBeInTheDocument();
  });
});

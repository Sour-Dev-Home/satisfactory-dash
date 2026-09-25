import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { signOutFromMenu } from "../test/account";
import { focusManager } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type StatusResponse } from "@satisfactory-dash/shared";
import {
  errorSessionRequired,
  factoryMixed,
  powerOk,
  serversMultiple,
  sessionAnonymous,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { POLL_MS } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

// Fresh-eyes pass over the whole session lifecycle, through the real App tree: session expiry
// mid-use, what survives a sign-out, re-login, and polling after each of those.

function submitLogin() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "operator" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "example-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

/** Counts every request to a scoped resource, by server id. */
function countScoped() {
  const counts: Record<string, number> = {};
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  return { counts, bump };
}

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("session lifecycle", () => {
  it("keeps nothing auth-related in web storage or script-readable cookies", async () => {
    localStorage.clear();
    sessionStorage.clear();
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    submitLogin();
    await screen.findByRole("button", { name: "Account" });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    await signOutFromMenu();
    await screen.findByRole("heading", { name: "Sign in" });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("stops every poll once a mid-use 401 signs the operator out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let expired = false;
    let protectedCalls = 0;
    const guard = (body: StatusResponse) => () => {
      protectedCalls++;
      return expired ? HttpResponse.json(errorSessionRequired, { status: 401 }) : HttpResponse.json(body);
    };
    server.use(http.get(endpoints.status.route, guard(statusRunning)));
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Server status" });

    expired = true;
    act(() => void vi.advanceTimersByTime(POLL_MS.status));
    await screen.findByRole("heading", { name: "Sign in" });
    const afterSignOut = protectedCalls;
    act(() => void vi.advanceTimersByTime(POLL_MS.factory * 3));
    await delay(30);
    expect(protectedCalls).toBe(afterSignOut);
  });

  it("does not show the old session's values after re-login until fresh data arrives", async () => {
    const before = { ...statusRunning, data: { ...statusRunning.data, sessionName: "Old session save" } } satisfies StatusResponse;
    let phase: "before" | "expired" | "after" = "before";
    server.use(
      http.get(endpoints.status.route, async () => {
        if (phase === "expired") return HttpResponse.json(errorSessionRequired, { status: 401 });
        if (phase === "after") {
          await delay(60);
          return HttpResponse.json(statusRunning);
        }
        return HttpResponse.json(before);
      }),
    );
    const { client } = renderWithClient(<App />);
    await screen.findByText("Old session save");
    phase = "expired";
    await act(() => client.refetchQueries({ type: "active" }));
    await screen.findByRole("heading", { name: "Sign in" });

    phase = "after";
    submitLogin();
    await screen.findByRole("button", { name: "Account" });
    expect(screen.queryByText("Old session save")).not.toBeInTheDocument();
    expect(await screen.findByText(statusRunning.data.sessionName)).toBeInTheDocument();
  });

  it("is not signed out again by a 401 from a request that started before re-login", async () => {
    let factoryReads = 0;
    let powerReads = 0;
    server.use(
      http.get(endpoints.factory.route, async () => {
        // The first factory read is slow: it outlives the session and the re-login.
        if (++factoryReads === 1) {
          await delay(150);
          return HttpResponse.json(errorSessionRequired, { status: 401 });
        }
        return HttpResponse.json(factoryMixed);
      }),
      // The first power read finds the session expired.
      http.get(endpoints.power.route, () =>
        ++powerReads === 1 ? HttpResponse.json(errorSessionRequired, { status: 401 }) : HttpResponse.json(powerOk),
      ),
    );
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(factoryReads).toBe(1);
    submitLogin();
    await screen.findByRole("button", { name: "Account" });
    // Inside act: the re-login's own queries resolve during this wait and update the tree.
    await act(() => delay(200));
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("stops polling the old server after switching servers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { counts, bump } = countScoped();
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json(serversMultiple)),
      http.get(endpoints.status.route, ({ params }) => {
        bump(String(params.serverId));
        return HttpResponse.json({ ...statusRunning, serverId: String(params.serverId) });
      }),
    );
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Satisfactory server" }));
    await screen.findByRole("heading", { name: "Server status" });
    fireEvent.click(screen.getByRole("button", { name: "Change server" }));
    fireEvent.click(await screen.findByRole("button", { name: "Creative test world" }));
    await screen.findByRole("heading", { name: "Server status" });
    await waitFor(() => expect(counts["creative-test"]).toBe(1));
    const oldServerCalls = counts.default;

    // waitFor polls with setInterval, which is faked here, so settle with a real delay instead.
    for (let tick = 2; tick <= 3; tick++) {
      act(() => void vi.advanceTimersByTime(POLL_MS.status));
      await delay(50);
      expect(counts["creative-test"]).toBe(tick);
    }
    expect(counts.default).toBe(oldServerCalls);
  });

  it("does not poll while the tab is in the background", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let statusCalls = 0;
    server.use(
      http.get(endpoints.status.route, () => {
        statusCalls++;
        return HttpResponse.json(statusRunning);
      }),
    );
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Server status" });
    const beforeHidden = statusCalls;
    act(() => focusManager.setFocused(false));
    act(() => void vi.advanceTimersByTime(POLL_MS.status * 3));
    await delay(30);
    expect(statusCalls).toBe(beforeHidden);
  });
});

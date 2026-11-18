import { fireEvent, screen, waitFor } from "@testing-library/react";
import { openAccountMenu, signOutFromMenu } from "../test/account";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorSessionRequired,
  sessionAnonymous,
  sessionAuthenticated,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";

/** A child that calls a protected route, like every dashboard view will. */
function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
}

/** Like the shell: the account menu renders inside the gate. */
function renderGate() {
  return renderWithClient(
    <AuthGate>
      <AccountMenu />
      <ServerList />
    </AuthGate>,
  );
}

function signedOut() {
  server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
}

describe("AuthGate", () => {
  it("shows a status while the session is being checked", async () => {
    server.use(
      http.get(endpoints.auth.session.route, async () => {
        await delay(50);
        return HttpResponse.json(sessionAuthenticated);
      }),
    );
    renderGate();
    expect(screen.getByRole("status")).toHaveTextContent("Checking session");
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
  });

  it("shows the app and the operator's name when signed in", async () => {
    renderGate();
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
    expect((await openAccountMenu()).getByText("operator")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the login screen when signed out, without calling protected routes", async () => {
    let serversCalled = false;
    signedOut();
    server.use(
      http.get(endpoints.servers.route, () => {
        serversCalled = true;
        return HttpResponse.json(serversSingle);
      }),
    );
    renderGate();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(serversCalled).toBe(false);
  });

  it("offers only Google when signed out: no username or password form (ADR-0025 PR 9)", async () => {
    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json({ ...sessionAnonymous, signInMethods: ["google"] })),
    );
    renderGate();
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("says sign-in isn't available when the session names no methods (an older backend)", async () => {
    signedOut();
    renderGate();
    expect(await screen.findByText("Sign-in isn't available on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("goes to the login screen when a protected route answers 401", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })));
    renderGate();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("treats a 401 from the session check itself as signed out", async () => {
    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })),
    );
    renderGate();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("clears other cached data when the session ends", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })));
    const { client } = renderGate();
    client.setQueryData(queries.health().queryKey, { status: "ok" });
    await screen.findByRole("heading", { name: "Sign in" });
    expect(client.getQueryData(queries.health().queryKey)).toBeUndefined();
    expect(client.getQueryData(queries.session().queryKey)).toEqual(sessionAnonymous);
  });

  it("logs out and returns to the login screen", async () => {
    let loggedOut = false;
    server.use(
      http.post(endpoints.auth.logout.route, () => {
        loggedOut = true;
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    renderGate();
    await signOutFromMenu();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(loggedOut).toBe(true);
    expect(screen.queryByText("servers: 1")).not.toBeInTheDocument();
  });

  it("returns to the login screen when logout finds the session already expired", async () => {
    server.use(http.post(endpoints.auth.logout.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })));
    renderGate();
    await signOutFromMenu();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows an error with a retry when the session check fails", async () => {
    let fail = true;
    server.use(
      http.get(endpoints.auth.session.route, () =>
        fail ? HttpResponse.text("Bad Gateway", { status: 502 }) : HttpResponse.json(sessionAuthenticated),
      ),
    );
    renderGate();
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "Couldn't reach the dashboard backend",
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("servers: 1")).toBeInTheDocument());
  });
});

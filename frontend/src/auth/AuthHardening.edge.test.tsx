import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type LoginRequest } from "@satisfactory-dash/shared";
import { errorLoginFailed, sessionAnonymous, sessionAuthenticated } from "@satisfactory-dash/shared/fixtures";
import { createQueryClient, isSignedOut, queries, SESSION_KEY } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AuthGate } from "./AuthGate";

const PASSWORD = "example-password";

function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
}

function signedOut() {
  server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
}

function fillLogin(password = PASSWORD) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "operator" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

describe("isSignedOut", () => {
  it("is false while the session is unknown, true only for authenticated:false", () => {
    const client = createQueryClient();
    expect(isSignedOut(client)).toBe(false);
    client.setQueryData(SESSION_KEY, sessionAuthenticated);
    expect(isSignedOut(client)).toBe(false);
    client.setQueryData(SESSION_KEY, sessionAnonymous);
    expect(isSignedOut(client)).toBe(true);
  });
});

describe("auth hardening, edge cases", () => {
  it("lets the operator retry after a failed login, sending the new password", async () => {
    const bodies: LoginRequest[] = [];
    signedOut();
    server.use(
      http.post(endpoints.auth.login.route, async ({ request }) => {
        const body = (await request.json()) as LoginRequest;
        bodies.push(body);
        return body.password === "right-password"
          ? HttpResponse.json(sessionAuthenticated)
          : HttpResponse.json(errorLoginFailed, { status: 401 });
      }),
    );
    const { container } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    fillLogin("wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorLoginFailed.error.message);
    // Password cleared from the form and the DOM, username kept, button usable again.
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("operator");
    expect(container.innerHTML).not.toContain("wrong-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "right-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
    expect(bodies).toEqual([
      { username: "operator", password: "wrong-password" },
      { username: "operator", password: "right-password" },
    ]);
  });

  it("shows the pending state and disables the button while signing in", async () => {
    signedOut();
    server.use(
      http.post(endpoints.auth.login.route, async () => {
        await delay(50);
        return HttpResponse.json(sessionAuthenticated);
      }),
    );
    renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
  });

  it("sends exactly one login with the right body under StrictMode", async () => {
    const bodies: unknown[] = [];
    signedOut();
    server.use(
      http.post(endpoints.auth.login.route, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(sessionAuthenticated);
      }),
    );
    const client = createQueryClient();
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <AuthGate>
            <ServerList />
          </AuthGate>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
    expect(bodies).toEqual([{ username: "operator", password: PASSWORD }]);
  });

  it("signs back in right after a session check dropped the data", async () => {
    let serverFetches = 0;
    server.use(
      http.get(endpoints.servers.route, () => {
        serverFetches++;
        return HttpResponse.json({ servers: [] });
      }),
    );
    const { client } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByText("servers: 0");

    signedOut();
    await client.refetchQueries({ queryKey: SESSION_KEY });
    await screen.findByRole("heading", { name: "Sign in" });

    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("servers: 0")).toBeInTheDocument();
    expect(serverFetches).toBe(2);
    expect(isSignedOut(client)).toBe(false);
  });

  it("stays signed in when a signed-out session check was already in flight during login", async () => {
    // e.g. the operator tabs to a password manager and back (focus refetch of the session,
    // sent without a cookie) and submits before that check answers.
    let releaseSession: () => void = () => {};
    let sessionGets = 0;
    server.use(
      http.get(endpoints.auth.session.route, async () => {
        sessionGets++;
        if (sessionGets > 1) {
          await new Promise<void>((resolve) => {
            releaseSession = resolve;
          });
        }
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    const { client } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    void client.refetchQueries({ queryKey: SESSION_KEY });
    await waitFor(() => expect(sessionGets).toBe(2));

    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("servers: 1");

    releaseSession();
    await waitFor(() => expect(client.isFetching({ queryKey: SESSION_KEY })).toBe(0));
    expect(screen.getByText("servers: 1")).toBeInTheDocument();
    expect(client.getQueryData(SESSION_KEY)).toEqual(sessionAuthenticated);
  });
});

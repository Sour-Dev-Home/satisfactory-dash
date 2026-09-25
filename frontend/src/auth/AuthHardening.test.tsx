import { fireEvent, screen, waitFor } from "@testing-library/react";
import { signOutFromMenu } from "../test/account";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorLoginFailed,
  serversSingle,
  sessionAnonymous,
  sessionAuthenticated,
  settingsEditable,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { AutoPauseView } from "../settings/AutoPauseView";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";

const PASSWORD = "example-password";

function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
}

function signedOut() {
  server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
}

function fillLogin() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "operator" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
}

describe("auth hardening", () => {
  it("sends one login POST for a fast double submit", async () => {
    let posts = 0;
    signedOut();
    server.use(
      http.post(endpoints.auth.login.route, async () => {
        posts++;
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
    const form = screen.getByRole("form", { name: "Sign in" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await screen.findByText("servers: 1")).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it("keeps the password out of the mutation cache after a failed login", async () => {
    signedOut();
    server.use(http.post(endpoints.auth.login.route, () => HttpResponse.json(errorLoginFailed, { status: 401 })));
    const { client } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");

    const mutations = client.getMutationCache().getAll();
    expect(mutations.length).toBeGreaterThan(0);
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain(PASSWORD);
  });

  it("keeps the password out of the mutation cache after a successful login", async () => {
    signedOut();
    const { client } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("servers: 1");
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state))).not.toContain(PASSWORD);
  });

  it("drops cached data when a session check comes back signed out without a 401", async () => {
    const { client } = renderWithClient(
      <AuthGate>
        <ServerList />
      </AuthGate>,
    );
    await screen.findByText("servers: 1");
    expect(client.getQueryData(queries.servers().queryKey)).toEqual(serversSingle);

    // e.g. a focus refetch after the cookie expired: 200 authenticated:false, no 401 anywhere.
    signedOut();
    await client.refetchQueries({ queryKey: queries.session().queryKey });

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(client.getQueryData(queries.servers().queryKey)).toBeUndefined();
  });

  it("doesn't write settings back into the cache when a PUT finishes after logout", async () => {
    let releasePut: () => void = () => {};
    server.use(
      http.put(endpoints.settings.setAutoPause.route, async () => {
        await new Promise<void>((resolve) => {
          releasePut = resolve;
        });
        return HttpResponse.json({ ...settingsEditable, data: { ...settingsEditable.data, autoPause: true } });
      }),
    );
    const { client } = renderWithClient(
      <AuthGate>
        <AccountMenu />
        <ServerContext value={serversSingle.servers[0]}>
          <AutoPauseView />
        </ServerContext>
      </AuthGate>,
    );
    fireEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeDisabled());

    await signOutFromMenu();
    await screen.findByRole("heading", { name: "Sign in" });

    releasePut();
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryData(queries.settings("default").queryKey)).toBeUndefined();
  });
});

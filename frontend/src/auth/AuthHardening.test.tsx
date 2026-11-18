import { fireEvent, screen, waitFor } from "@testing-library/react";
import { openAccountMenu, signOutFromMenu } from "../test/account";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  serversSingle,
  sessionAnonymous,
  settingsEditable,
} from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { AutoPauseView } from "../settings/AutoPauseView";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";

function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
}

function signedOut() {
  server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
}

describe("auth hardening", () => {
  it("sends one logout POST for a fast double click", async () => {
    let posts = 0;
    server.use(
      http.post(endpoints.auth.logout.route, async () => {
        posts++;
        await delay(50);
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    renderWithClient(
      <AuthGate>
        <AccountMenu />
      </AuthGate>,
    );
    const menu = await openAccountMenu();
    const button = menu.getByRole("button", { name: "Sign out" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(posts).toBe(1);
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

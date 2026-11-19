import { screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { sessionAnonymous, sessionAuthenticated } from "@satisfactory-dash/shared/fixtures";
import { createQueryClient, isSignedOut, queries, SESSION_KEY } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AuthGate } from "./AuthGate";

function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
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
  it("shows the app again when a session check answers signed in after one dropped the data", async () => {
    // e.g. signed out in this tab, then signed in with Google in another: the next focus refetch says signed in.
    let serverFetches = 0;
    let signedIn = true;
    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json(signedIn ? sessionAuthenticated : sessionAnonymous)),
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

    signedIn = false;
    await client.refetchQueries({ queryKey: SESSION_KEY });
    await screen.findByRole("heading", { name: "Sign in" });

    signedIn = true;
    await client.refetchQueries({ queryKey: SESSION_KEY });
    expect(await screen.findByText("servers: 0")).toBeInTheDocument();
    expect(serverFetches).toBe(2);
    expect(isSignedOut(client)).toBe(false);
  });
});

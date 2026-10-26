import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import { SignedInUser } from "../auth/SignedInUser";
import { ServerGate } from "../servers/ServerGate";
import { useSelectedServer } from "../servers/ServerContext";
import { errorPairingForbidden, errorPairingNotFound, errorPairingRateLimited, lookedUp, PAIR_CODE } from "../test/pairingMocks";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AddServer } from "./AddServer";
import { PairPage } from "./PairPage";

const TWO_SERVERS: ServerListResponse = {
  servers: [
    { id: "alpha", displayName: "Alpha base", role: "owner" },
    { id: "beta", displayName: "Beta base", role: "admin" },
    { id: "gamma", displayName: "Gamma base", role: "viewer" },
  ],
};

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}
function Selected() {
  return <p>{`selected: ${useSelectedServer().displayName}`}</p>;
}

function renderPair(entry = "/app/pair") {
  return renderWithClient(
    <MemoryRouter initialEntries={[entry]}>
      <SignedInUser value={{ name: "Player" }}>
        <PairPage />
      </SignedInUser>
      <Where />
    </MemoryRouter>,
  );
}

const type = (value: string) => fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value } });
const submitCode = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
async function toConfirm() {
  type(PAIR_CODE);
  submitCode();
  await screen.findByText("Is this your server?");
}
const useList = (list: ServerListResponse) => server.use(http.get(endpoints.servers.route, () => HttpResponse.json(list)));

describe("PairPage: the code step", () => {
  it("says where to find the code and formats as the person types", () => {
    renderPair();
    expect(screen.getByText(/FactoryGame\.log/)).toBeInTheDocument();
    expect(screen.getByText(/pairing\.txt/)).toBeInTheDocument();
    type("ab3d7x");
    expect(screen.getByLabelText("Pairing code")).toHaveValue("AB3D-7X");
    type("ab3d-7xq2 k5mn extra");
    expect(screen.getByLabelText("Pairing code")).toHaveValue("AB3D-7XQ2-K5MN");
  });

  it("sends the normalised code, upper case with dashes", async () => {
    let sent: unknown;
    server.use(
      http.post(endpoints.pairings.lookup.route, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(lookedUp);
      }),
    );
    renderPair();
    type("ab3d7xq2k5mn");
    submitCode();
    await screen.findByText("Is this your server?");
    expect(sent).toEqual({ userCode: PAIR_CODE });
  });

  it("checks the shape before sending anything", async () => {
    let posts = 0;
    server.use(http.post(endpoints.pairings.lookup.route, () => ((posts += 1), HttpResponse.json(lookedUp))));
    renderPair();
    submitCode();
    expect(await screen.findByText("Enter the code from your server.")).toBeInTheDocument();
    type("0000-1111-8888");
    submitCode();
    expect(await screen.findByText(/never contains 0, 1, 8 or 9/)).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("ignores and strips a ?code= in the address", async () => {
    renderPair(`/app/pair?code=${PAIR_CODE}`);
    expect(screen.getByLabelText("Pairing code")).toHaveValue("");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/app\/pair$/));
  });

  it("answers an unknown code with the one message", async () => {
    server.use(http.post(endpoints.pairings.lookup.route, () => HttpResponse.json(errorPairingNotFound, { status: 404 })));
    renderPair();
    type(PAIR_CODE);
    submitCode();
    expect(await screen.findByText("That code isn't valid. Check it, or restart the server for a new one.")).toBeInTheDocument();
  });

  it("shows a calm wait for a 429", async () => {
    server.use(
      http.post(endpoints.pairings.lookup.route, () =>
        HttpResponse.json(errorPairingRateLimited, { status: 429, headers: { "Retry-After": "120" } }),
      ),
    );
    renderPair();
    type(PAIR_CODE);
    submitCode();
    expect(await screen.findByText("Too many tries. Wait about 2 minutes, then try again.")).toBeInTheDocument();
  });

  it("explains a 403 plainly", async () => {
    server.use(http.post(endpoints.pairings.lookup.route, () => HttpResponse.json(errorPairingForbidden, { status: 403 })));
    renderPair();
    type(PAIR_CODE);
    submitCode();
    expect(await screen.findByText(/isn't available to your account right now/)).toBeInTheDocument();
  });

  it("falls back to the shared error notice for a server fault", async () => {
    server.use(
      http.post(endpoints.pairings.lookup.route, () =>
        HttpResponse.json({ error: { code: "internal_error", message: "x", requestId: "00000000-0000-4000-8000-000000000684" } }, { status: 500 }),
      ),
    );
    renderPair();
    type(PAIR_CODE);
    submitCode();
    expect(await screen.findByText(/Request ID: 00000000-0000-4000-8000-000000000684/)).toBeInTheDocument();
  });
});

describe("PairPage: the confirmation step", () => {
  it("shows the name, version and age", async () => {
    renderPair();
    await toConfirm();
    expect(screen.getByText(lookedUp.serverName)).toBeInTheDocument();
    expect(screen.getByText(lookedUp.agentVersion)).toBeInTheDocument();
    expect(screen.getByText(/asked /)).toBeInTheDocument();
  });

  it("renders a hostile name as plain text", async () => {
    server.use(
      http.post(endpoints.pairings.lookup.route, () =>
        HttpResponse.json({ ...lookedUp, serverName: "<img src=x onerror=alert(1)><b>bold</b>" }),
      ),
    );
    const { container } = renderPair();
    await toConfirm();
    expect(screen.getByText("<img src=x onerror=alert(1)><b>bold</b>")).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("says so when the server gave no name", async () => {
    server.use(http.post(endpoints.pairings.lookup.route, () => HttpResponse.json({ ...lookedUp, serverName: null })));
    renderPair();
    await toConfirm();
    expect(screen.getByText("This server did not give a name.")).toBeInTheDocument();
  });

  it("approves as a new server and links to the dashboard", async () => {
    let sent: unknown;
    server.use(
      http.post(endpoints.pairings.approve.route, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ serverId: "fresh" });
      }),
    );
    const { client } = renderPair();
    await toConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Paired. Data arrives within a few seconds.")).toBeInTheDocument();
    expect(sent).toEqual({ userCode: PAIR_CODE, target: { kind: "new" } });
    expect(screen.getByRole("link", { name: "Open the dashboard" })).toHaveAttribute("href", "/app");
    // Nothing keeps the code: no mutation, no storage.
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PAIR_CODE);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PAIR_CODE);
  });

  it("re-pairs one of the person's own servers (owner or admin only) and says it replaces the credential", async () => {
    useList(TWO_SERVERS);
    let sent: unknown;
    server.use(
      http.post(endpoints.pairings.approve.route, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ serverId: "beta" });
      }),
    );
    renderPair();
    await toConfirm();
    fireEvent.click(screen.getByLabelText("One of my servers"));
    const select = await screen.findByLabelText("Server to re-pair");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha base", "Beta base"]);
    expect(screen.getByText(/replaces that server's credential/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Paired. Data arrives within a few seconds.");
    expect(sent).toEqual({ userCode: PAIR_CODE, target: { kind: "existing", serverId: "beta" } });
  });

  it("offers no re-pair when the person has no server they manage", async () => {
    useList({ servers: [{ id: "gamma", displayName: "Gamma base", role: "viewer" }] });
    renderPair();
    await toConfirm();
    await waitFor(() => expect(screen.getByLabelText("One of my servers")).toBeDisabled());
    expect(screen.getByText("You have no server you can re-pair yet.")).toBeInTheDocument();
  });

  it("shows the one message when the approval is refused as not found, and can start over", async () => {
    server.use(http.post(endpoints.pairings.approve.route, () => HttpResponse.json(errorPairingNotFound, { status: 404 })));
    renderPair();
    await toConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/That code isn't valid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use a different code" }));
    expect(await screen.findByLabelText("Pairing code")).toHaveValue("");
  });
});

describe("the way into and out of the page", () => {
  it("AddServer links to /app/pair", () => {
    renderWithClient(
      <MemoryRouter>
        <AddServer onCreated={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Pair it" })).toHaveAttribute("href", "/app/pair");
  });

  it("ServerGate opens the server named in the router state, and ignores an unknown one", async () => {
    useList(TWO_SERVERS);
    renderWithClient(
      <MemoryRouter>
        <SignedInUser value={{ name: "Player" }}>
          <ServerGate initialId="beta">
            <Selected />
          </ServerGate>
        </SignedInUser>
      </MemoryRouter>,
    );
    expect(await screen.findByText("selected: Beta base")).toBeInTheDocument();
  });

  it("ServerGate shows the picker when the state names no server in the list", async () => {
    useList(TWO_SERVERS);
    renderWithClient(
      <MemoryRouter>
        <SignedInUser value={{ name: "Player" }}>
          <ServerGate initialId="nope">
            <Selected />
          </ServerGate>
        </SignedInUser>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Choose a game server")).toBeInTheDocument();
  });
});

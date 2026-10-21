import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type ApiErrorResponse, type ServerListResponse, type SessionResponse } from "@satisfactory-dash/shared";
import { errorServiceUnavailable, serversSelfServe, sessionAuthenticatedWithAccount } from "@satisfactory-dash/shared/fixtures";
import { AuthGate } from "../auth/AuthGate";
import { SignedInUser, type Account } from "../auth/SignedInUser";
import { ServerGate } from "../servers/ServerGate";
import { useSelectedServer } from "../servers/ServerContext";
import { errorLastOwner, errorOperatorAccount, errorOperatorServers, errorReauthRequired } from "../test/accountMocks";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountSettings } from "./AccountSettings";

const [operatorServer, enrolledServer] = serversSelfServe.servers;
const GOOGLE_USER: Account = { name: "Ann", email: "ann@example.com", authMethods: ["google"] };

function serveList(initial: ServerListResponse) {
  const state = { list: initial };
  server.use(http.get(endpoints.servers.route, () => HttpResponse.json(state.list)));
  return state;
}

function Selected() {
  return <p>{`selected: ${useSelectedServer().displayName}`}</p>;
}

/** Settings' account part inside ServerGate, for a given signed-in account (no AuthGate). */
function renderAccount(user: Account = GOOGLE_USER) {
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <SignedInUser value={user}>
        <ServerGate>
          <Selected />
          <AccountSettings />
        </ServerGate>
      </SignedInUser>
    </MemoryRouter>,
  );
}

/** The same under the real AuthGate, with the session answered from a variable so a deletion can end it. */
function renderSignedIn(session: SessionResponse) {
  const state = { session };
  server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(state.session)));
  const view = renderWithClient(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <AuthGate>
        <ServerGate>
          <AccountSettings />
        </ServerGate>
      </AuthGate>
    </MemoryRouter>,
  );
  return { ...view, state };
}

const googleSession = { ...sessionAuthenticatedWithAccount, signInMethods: ["google"] } satisfies SessionResponse;

const openDelete = async () => fireEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
const confirmDelete = () => fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
const refuseDelete = (status: number, body: ApiErrorResponse) =>
  server.use(http.delete(endpoints.account.remove.route, () => HttpResponse.json(body, { status })));

describe("Delete my account", () => {
  it("is not offered to a session with no stored account (no database: the session names no sign-in methods)", async () => {
    serveList({ servers: [operatorServer] });
    renderAccount({ name: "operator" });
    await screen.findByText("selected: Satisfactory server");
    expect(screen.queryByRole("heading", { name: "Delete my account" })).not.toBeInTheDocument();
  });

  it("is on the no-server screens too, since Settings needs a server (left the last one, or never had one)", async () => {
    const state = serveList({ servers: [], selfServeEnabled: true });
    const view = renderAccount();
    expect(await screen.findByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
    view.unmount();
    state.list = { servers: [] };
    renderAccount();
    await screen.findByText("No game servers are configured.");
    expect(screen.getByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
  });

  it("tells the operator their account can't be deleted here, with no button", async () => {
    serveList({ servers: [{ ...operatorServer, role: "owner" }], canManageServers: true });
    renderAccount({ name: "operator", authMethods: ["password"] });
    expect(await screen.findByText("The operator's account can't be deleted here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete my account/ })).not.toBeInTheDocument();
  });

  it("says what goes and what stays, never 'delete a server', and that the game is never touched", async () => {
    serveList({ servers: [enrolledServer] });
    renderAccount();
    const section = within((await screen.findByRole("heading", { name: "Delete my account" })).closest("section")!);
    for (const item of ["Your account and your sign-in", "Every session, on every device", "Your membership of every server", "Your alert notification sign-ups"]) {
      expect(section.getByText(item)).toBeInTheDocument();
    }
    expect(section.getByText("Servers you added yourself are removed from Satisfactory Dash.")).toBeInTheDocument();
    expect(section.getByText(/Your game and its saves are never touched/)).toBeInTheDocument();
    expect(section.getByText(/audit records .* name only a random id/)).toBeInTheDocument();
    expect(section.getByRole("link", { name: "Privacy policy (opens in a new tab)" })).toHaveAttribute("href", "/privacy.html");
    expect(section.queryByText(/delete (a|the|this) server/i)).not.toBeInTheDocument();
  });

  it("confirms first, naming the self-serve servers it removes, with focus moving in and back on Cancel or Escape", async () => {
    let deletes = 0;
    server.use(http.delete(endpoints.account.remove.route, () => ((deletes += 1), HttpResponse.json({ deleted: true }))));
    serveList({ servers: [enrolledServer] });
    renderAccount();
    await openDelete();
    const form = screen.getByRole("form", { name: "Confirm deleting your account" });
    expect(within(form).getByText("Delete your account now? This can't be undone.")).toHaveFocus();
    expect(within(form).getByText("My first world")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete my account…" })).toHaveFocus();
    await openDelete();
    fireEvent.keyDown(screen.getByRole("form", { name: "Confirm deleting your account" }), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Confirm deleting your account" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my account…" })).toHaveFocus();
    expect(deletes).toBe(0);
  });

  it("names no server in the confirm when the account owns none it added", async () => {
    serveList({ servers: [operatorServer] });
    renderAccount();
    await openDelete();
    expect(screen.queryByText(/removed from Satisfactory Dash with it/)).not.toBeInTheDocument();
  });

  it("deletes once on a double click, then signs out to the sign-in screen with a short confirmation", async () => {
    serveList({ servers: [enrolledServer] });
    let deletes = 0;
    const { state } = renderSignedIn(googleSession);
    server.use(
      http.delete(endpoints.account.remove.route, () => {
        deletes += 1;
        state.session = { authenticated: false, signInMethods: ["google"] };
        return HttpResponse.json({ deleted: true });
      }),
    );
    await openDelete();
    confirmDelete();
    confirmDelete();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your account was deleted. Your game and its saves were not touched.");
    // The sign-in methods the session named are kept: Google is still offered.
    expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(deletes).toBe(1);
  });

  it("asks for a fresh Google sign-in on reauth_required, back to Settings, and stays signed in", async () => {
    serveList({ servers: [enrolledServer] });
    refuseDelete(403, errorReauthRequired);
    renderSignedIn(googleSession);
    await openDelete();
    confirmDelete();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("sign in again first: it needs a sign-in from the last 10 minutes");
    expect(alert).toHaveFocus();
    const link = within(alert).getByRole("link", { name: "Sign in again with Google" });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("return")).toBe("/app/settings");
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    // After signing in again, the person can try again from the same confirm.
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
  });

  it("offers sign out and in again on reauth_required for an account without Google", async () => {
    serveList({ servers: [operatorServer] });
    refuseDelete(403, errorReauthRequired);
    renderAccount({ name: "Bo", authMethods: ["password"] });
    await openDelete();
    confirmDelete();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign out, sign in again, then come back to Settings");
    expect(within(alert).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
  });

  it("lists the operator's servers that block the deletion (409 operator_servers)", async () => {
    serveList({ servers: [operatorServer] });
    refuseDelete(409, errorOperatorServers);
    renderAccount();
    await openDelete();
    confirmDelete();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You own servers the operator set up, so your account can't be deleted yet:");
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Satisfactory server", "Creative test world"]);
    expect(alert).toHaveTextContent("They need a new owner first. Contact the operator.");
  });

  it("explains the operator's account can't be deleted (403 operator_account)", async () => {
    serveList({ servers: [operatorServer] });
    refuseDelete(403, errorOperatorAccount);
    renderAccount();
    await openDelete();
    confirmDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent("The operator's account can't be deleted here.");
  });

  it("shows any other failure through ErrorNotice, with its request id", async () => {
    serveList({ servers: [operatorServer] });
    refuseDelete(503, errorServiceUnavailable);
    renderAccount();
    await openDelete();
    confirmDelete();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(errorServiceUnavailable.error.message);
    expect(alert).toHaveTextContent(errorServiceUnavailable.error.requestId);
  });
});

describe("Leave this server", () => {
  it("shows nothing when the list names no role (no membership to leave)", async () => {
    serveList({ servers: [{ id: "default", displayName: "Satisfactory server" }] });
    renderAccount();
    await screen.findByText("selected: Satisfactory server");
    expect(screen.queryByRole("heading", { name: "Your membership" })).not.toBeInTheDocument();
  });

  it("gives the owner the reason instead of the button, pointing a self-serve owner at removing it", async () => {
    serveList({ servers: [enrolledServer] });
    renderAccount();
    expect(
      await screen.findByText(/You own My first world, so you can't leave it\. To stop using it, remove it from Satisfactory Dash/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Leave/ })).not.toBeInTheDocument();
  });

  it("gives the owner of an operator server no removal hint", async () => {
    serveList({ servers: [{ ...operatorServer, role: "owner" }] });
    renderAccount();
    expect(await screen.findByText("You own Satisfactory server, so you can't leave it.")).toBeInTheDocument();
  });

  it("lets a viewer leave after a confirm; the selection drops and the list is read again", async () => {
    const other = { id: "creative-test", displayName: "Creative test world", role: "viewer" };
    const state = serveList({ servers: [operatorServer] });
    const paths: string[] = [];
    server.use(
      http.post(endpoints.members.leave.route, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        state.list = { servers: [other] };
        return HttpResponse.json({ left: true });
      }),
    );
    renderAccount();
    expect(await screen.findByText("Your role on Satisfactory server: viewer.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave this server…" }));
    const form = screen.getByRole("form", { name: "Confirm leaving Satisfactory server" });
    expect(within(form).getByText("Leave Satisfactory server?").parentElement).toHaveFocus();
    expect(within(form).getByText(/The server and its game are not changed/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Leave server" }));
    fireEvent.click(within(form).getByRole("button", { name: /Leav/ }));
    expect(await screen.findByText("selected: Creative test world")).toBeInTheDocument();
    expect(paths).toEqual([endpoints.members.leave.path("default")]);
    // The picker never says the server left was "no longer available": nothing answered server_not_found.
    expect(screen.queryByText("The selected server is no longer available.")).not.toBeInTheDocument();
  });

  it("cancels back to the button, focus included", async () => {
    serveList({ servers: [operatorServer] });
    renderAccount();
    fireEvent.click(await screen.findByRole("button", { name: "Leave this server…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Leave this server…" })).toHaveFocus();
  });

  it("words a last_owner refusal (the role changed meanwhile)", async () => {
    serveList({ servers: [operatorServer] });
    server.use(http.post(endpoints.members.leave.route, () => HttpResponse.json(errorLastOwner, { status: 409 })));
    renderAccount();
    fireEvent.click(await screen.findByRole("button", { name: "Leave this server…" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave server" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You own this server, so you can't leave it.");
    expect(screen.getByText("selected: Satisfactory server")).toBeInTheDocument();
  });

  it("shows any other failure through ErrorNotice and keeps the server selected", async () => {
    serveList({ servers: [operatorServer] });
    server.use(http.post(endpoints.members.leave.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    renderAccount();
    fireEvent.click(await screen.findByRole("button", { name: "Leave this server…" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave server" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorServiceUnavailable.error.requestId);
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave server" })).toBeEnabled());
    expect(screen.getByText("selected: Satisfactory server")).toBeInTheDocument();
  });
});

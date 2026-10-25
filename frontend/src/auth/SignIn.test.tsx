import { fireEvent, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { errorServiceUnavailable, sessionAnonymous, sessionAuthenticatedWithAccount } from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { openAccountMenu, signOutFromMenu } from "../test/account";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";
import { TERMS_CHANGES, TERMS_VERSION } from "./googleSignIn";

function ServerList() {
  const servers = useQuery(queries.servers());
  return <p>{servers.data ? `servers: ${servers.data.servers.length}` : "loading servers"}</p>;
}

// ADR-0025 PR 8: the sign-in screen with Google, and the account menu's two sign-outs.

const withGoogle = { ...sessionAnonymous, signInMethods: ["password", "google"] };

function renderGate() {
  return renderWithClient(
    <AuthGate>
      <AccountMenu />
      <p>the dashboard</p>
    </AuthGate>,
  );
}

afterEach(() => window.history.replaceState(null, "", "/app"));

describe("the sign-in screen", () => {
  it("offers Google when the backend does, as a full-page link that returns to this page", async () => {
    window.history.replaceState(null, "", "/app/power");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(withGoogle)));
    renderGate();
    const google = await screen.findByRole("link", { name: "Sign in with Google" });
    const href = new URL(google.getAttribute("href")!, "http://x");
    expect(href.pathname).toBe("/api/auth/google/start");
    expect(href.searchParams.get("return")).toBe("/app/power");
    // The password form stays (until ADR-0025 PR 9).
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("offers no Google when the backend doesn't list it (or is older and sends no list)", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    renderGate();
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("shows the fixed text for a Google error code, never the query itself", async () => {
    window.history.replaceState(null, "", "/app/login?error=not_invited&note=%3Cb%3Eowned%3C%2Fb%3E");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(withGoogle)));
    const { container } = renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Google account hasn't been invited yet. Ask the server's owner for an invitation.",
    );
    expect(container.textContent).not.toContain("owned");
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("the terms step of open sign-up (ADR-0046)", () => {
  const open = { ...sessionAnonymous, signInMethods: ["password", "google", "google_signup"] };

  it("shows nothing about terms on a plain sign-in, even when sign-up is open (an existing account never sees it)", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(open)));
    renderGate();
    await screen.findByRole("link", { name: "Sign in with Google" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows an unticked box after a new account is found; Continue needs the tick and sends the version", async () => {
    window.history.replaceState(null, "", "/app/login?error=terms_required");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(open)));
    renderGate();
    const box = await screen.findByRole("checkbox", { name: /I accept the/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Accept the Terms below");
    expect(screen.getByRole("link", { name: /Terms/ })).toHaveAttribute("href", "/terms.html");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Continue with Google" })).not.toBeInTheDocument();
    fireEvent.click(box);
    const go = screen.getByRole("link", { name: "Continue with Google" });
    expect(new URL(go.getAttribute("href")!, "http://x").searchParams.get("terms")).toBe(TERMS_VERSION);
  });

  it("shows no terms step when the backend does not offer sign-up, whatever the URL says", async () => {
    window.history.replaceState(null, "", "/app/login?error=terms_required");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(withGoogle)));
    renderGate();
    await screen.findByRole("link", { name: "Sign in with Google" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says new accounts are paused on signup_busy", async () => {
    window.history.replaceState(null, "", "/app/login?error=signup_busy");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(open)));
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("New accounts are paused for a while. Try again later.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("re-accepting changed terms (#568)", () => {
  it.each([
    ["sign-up is closed", withGoogle],
    ["sign-up is open", { ...sessionAnonymous, signInMethods: ["password", "google", "google_signup"] }],
  ])("lists what changed, links the Terms, needs the tick, and keeps the return path (%s)", async (_label, session) => {
    window.history.replaceState(null, "", "/app/login?error=terms_changed&return=%2Fapp%2Fpower");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(session)));
    renderGate();
    const box = await screen.findByRole("checkbox", { name: /I accept the updated Terms/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole("group", { name: "The Terms have changed" })).toBeInTheDocument();
    // An expected step, not a failure: no alert banner repeating the legend.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("You accepted an earlier version. Accept this one to continue.")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([...TERMS_CHANGES]);
    expect(screen.getByRole("link", { name: /updated Terms/ })).toHaveAttribute("href", "/terms.html");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    fireEvent.click(box);
    const href = new URL(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")!, "http://x");
    expect(href.searchParams.get("terms")).toBe(TERMS_VERSION);
    expect(href.searchParams.get("return")).toBe("/app/power");
  });

  it("offers a decline that goes back to the plain sign-in page (no session exists to sign out of)", async () => {
    window.history.replaceState(null, "", "/app/login?error=terms_changed");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(withGoogle)));
    renderGate();
    expect(await screen.findByRole("link", { name: "Decline and stay signed out" })).toHaveAttribute("href", "/app/login");
  });

  it("shows the message but no terms step when Google is not offered", async () => {
    window.history.replaceState(null, "", "/app/login?error=terms_changed");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("The Terms have changed");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Decline/ })).not.toBeInTheDocument();
  });

  it("shows the sign-up terms step, not the re-accept step, for terms_required", async () => {
    window.history.replaceState(null, "", "/app/login?error=terms_required");
    server.use(
      http.get(endpoints.auth.session.route, () =>
        HttpResponse.json({ ...sessionAnonymous, signInMethods: ["password", "google", "google_signup"] }),
      ),
    );
    renderGate();
    await screen.findByRole("checkbox");
    expect(screen.queryByText("What changed:")).not.toBeInTheDocument();
  });

  it("shows nothing about changed terms on a plain sign-in", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(withGoogle)));
    renderGate();
    await screen.findByRole("link", { name: "Sign in with Google" });
    expect(screen.queryByText("What changed:")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Decline/ })).not.toBeInTheDocument();
  });
});

describe("signing out", () => {
  it("shows the account's name and email in the menu", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAuthenticatedWithAccount)));
    renderGate();
    const menu = await openAccountMenu();
    expect(menu.getByText(sessionAuthenticatedWithAccount.user.name)).toBeInTheDocument();
    expect(menu.getByText(sessionAuthenticatedWithAccount.user.email)).toBeInTheDocument();
  });

  it("everywhere: calls logout-all and returns to the sign-in screen", async () => {
    let calledAll = false;
    server.use(
      http.post(endpoints.auth.logoutAll.route, () => {
        calledAll = true;
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    renderGate();
    await signOutFromMenu(true);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(calledAll).toBe(true);
  });

  it.each([false, true])("a 503 stays signed in and says it couldn't sign out (everywhere: %s)", async (everywhere) => {
    const route = everywhere ? endpoints.auth.logoutAll.route : endpoints.auth.logout.route;
    server.use(http.post(route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    renderGate();
    await signOutFromMenu(everywhere);
    expect(await screen.findByText("Couldn't sign out, try again.")).toBeInTheDocument();
    expect(screen.getByText("the dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("keeps Google on offer even when an in-flight request 401s right after logout-all", async () => {
    server.use(
      http.post(endpoints.auth.logoutAll.route, () => HttpResponse.json(withGoogle)),
      http.get(endpoints.servers.route, async () => {
        await delay(50);
        return HttpResponse.json({ error: { code: "unauthorized", message: "no", requestId: "x" } }, { status: 401 });
      }),
    );
    renderWithClient(
      <AuthGate>
        <AccountMenu />
        <ServerList />
      </AuthGate>,
    );
    await screen.findByText("loading servers");
    await signOutFromMenu(true);
    await screen.findByRole("heading", { name: "Sign in" });
    // Give the slow servers request a chance to land its 401 after sign-out.
    await new Promise((r) => setTimeout(r, 100));
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  });

  it("keeps Google on offer after signing out (the backend's answer says so)", async () => {
    server.use(http.post(endpoints.auth.logout.route, () => HttpResponse.json(withGoogle)));
    renderGate();
    await signOutFromMenu();
    expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  });
});

describe("the account menu", () => {
  it("closes on Escape and gives focus back to its button", async () => {
    renderGate();
    await openAccountMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    const toggle = screen.getByRole("button", { name: "Account" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(document.activeElement).toBe(toggle);
  });

  it("closes on a click outside", async () => {
    renderGate();
    await openAccountMenu();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("aria-expanded", "false"));
  });

  it("closes, not stays open, when the toggle itself is clicked again (no double toggle)", async () => {
    renderGate();
    await openAccountMenu();
    const toggle = screen.getByRole("button", { name: "Account" });
    // A real click fires pointerdown (the outside-click listener sees it land inside root,
    // since the toggle is inside root) then click (the toggle's own handler).
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape does nothing while the panel is already closed", async () => {
    renderGate();
    const toggle = await screen.findByRole("button", { name: "Account" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).not.toBe(toggle);
  });

  it("unmounting while open doesn't leak its document listeners", async () => {
    const { unmount } = renderGate();
    await openAccountMenu();
    unmount();
    // A leaked listener would call setState on the unmounted component (an RTL/React warning,
    // or a thrown error) when a later Escape or outside click fires.
    expect(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.pointerDown(document.body);
    }).not.toThrow();
  });
});

describe("a 503 on the session check", () => {
  it("is an error with Retry, never the sign-in screen", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    renderGate();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorServiceUnavailable, sessionAnonymous, sessionAuthenticatedWithAccount } from "@satisfactory-dash/shared/fixtures";
import { openAccountMenu, signOutFromMenu } from "../test/account";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AccountMenu } from "./AccountMenu";
import { AuthGate } from "./AuthGate";

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
});

describe("a 503 on the session check", () => {
  it("is an error with Retry, never the sign-in screen", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(errorServiceUnavailable, { status: 503 })));
    renderGate();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });
});

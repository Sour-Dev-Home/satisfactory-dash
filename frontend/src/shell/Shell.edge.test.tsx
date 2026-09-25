import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { openAccountMenu, signOutFromMenu } from "../test/account";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversMultiple, sessionAnonymous } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

// Fresh-eyes pass (test-hunter) over the shell: redirects, focus after navigation, the server
// switcher, the signed-in user after re-login, and the crash probe across tabs.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("redirects", () => {
  it("keeps the query string on a nested unknown path inside the app", async () => {
    window.history.pushState(null, "", "/app/power/extra?scenario=outage");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" });
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?scenario=outage");
  });

  it("keeps the query string on a nested unknown path outside the app", async () => {
    window.history.pushState(null, "", "/public/page?scenario=outage");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" });
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?scenario=outage");
  });

  it("serves /app/ and /app/power/ without redirecting", async () => {
    window.history.pushState(null, "", "/app/power/");
    renderWithClient(<App />);
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/power/");
  });
});

describe("focus after navigation", () => {
  // The row link is gone once its page opens, so focus falls to <body> and a keyboard or
  // screen reader user starts over from the top of the document.
  it("doesn't drop focus to the body after opening a section from its Overview row", async () => {
    renderWithClient(<App />);
    const rows = await screen.findByRole("list", { name: "Sections" });
    const link = await within(rows).findByRole("link", { name: /Power/ });
    link.focus();
    fireEvent.click(link);
    await screen.findByRole("region", { name: "Power" });
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("server switcher", () => {
  it("changes server with several servers and stays on the current page", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(serversMultiple)));
    window.history.pushState(null, "", "/app/power");
    renderWithClient(<App />);
    const [first, second] = serversMultiple.servers;
    fireEvent.click(await screen.findByRole("button", { name: first.displayName }));
    expect(await screen.findByText(first.displayName)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change server" }));
    fireEvent.click(await screen.findByRole("button", { name: second.displayName }));

    expect(await screen.findByText(second.displayName)).toBeInTheDocument();
    expect(screen.queryByText(first.displayName)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change server" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/power");
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
  });

  it("doesn't drop focus to the body after Change server", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(serversMultiple)));
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: serversMultiple.servers[0].displayName }));
    const change = await screen.findByRole("button", { name: "Change server" });
    change.focus();
    fireEvent.click(change);
    await screen.findByRole("heading", { name: "Choose a game server" });
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("signed-in user", () => {
  it("shows the new operator's name after signing out and in as someone else", async () => {
    renderWithClient(<App />);
    expect((await openAccountMenu()).getByText("operator")).toBeInTheDocument();

    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)),
      http.post(endpoints.auth.login.route, () =>
        HttpResponse.json({ authenticated: true, user: { name: "second-operator" } }),
      ),
    );
    await signOutFromMenu();
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "second-operator" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "example-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const menu = await openAccountMenu();
    expect(menu.getByText("second-operator")).toBeInTheDocument();
    expect(menu.queryByText("operator")).not.toBeInTheDocument();
    // The app works again after re-login: the Overview loads fresh data.
    const rows = await screen.findByRole("list", { name: "Sections" });
    await waitFor(() => expect(within(rows).queryByText("Loading…")).not.toBeInTheDocument());
  });
});

describe("crash probe across tabs (mock mode)", () => {
  it("crashes only the requested page, and not again after leaving and coming back", async () => {
    vi.stubEnv("MODE", "mock");
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.pushState(null, "", "/app/factory?crash=factory");
    renderWithClient(<App />);
    expect(await screen.findByRole("alert", { name: "Factory error" })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(within(nav).getByRole("link", { name: "Power" }));
    expect(await screen.findByRole("region", { name: "Power" })).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: /error/ })).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Factory" }));
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Factory error" })).not.toBeInTheDocument();
  });
});

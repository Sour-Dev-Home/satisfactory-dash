import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorConnectionTestFailed,
  errorConnectionUnreadable,
  errorImportRequired,
  errorLanRequiresCertPinning,
  errorOperatorOnly,
  managedServersAllStates,
  managedServersEmpty,
  serverConnectionOk,
  testConnectionApiUnauthorized,
  testConnectionFrmUnreachable,
} from "@satisfactory-dash/shared/fixtures";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { ServerManagementView } from "./ServerManagementView";

const [okServer, unreadableServer, refusedServer] = managedServersAllStates.servers;

function renderView() {
  return renderWithClient(<ServerManagementView />);
}

/** Records every body sent to a route and answers with `reply`. */
function capture(method: "post" | "patch", route: string, reply: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http[method](route, async ({ request }) => {
      bodies.push(await request.json());
      return reply();
    }),
  );
  return bodies;
}

const row = (name: string) => screen.getByRole("listitem", { name });
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ServerManagementView: the list", () => {
  it("shows each stored server with its address and token suffixes, never a token", async () => {
    renderView();
    const ok = await screen.findByRole("listitem", { name: okServer.displayName });
    expect(ok).toHaveTextContent("127.0.0.1, game API port 7777, FRM port 8080");
    expect(ok).toHaveTextContent("API token ends in 1a2b · FRM token ends in 3c4d");
  });

  it("offers re-entering both tokens, renaming and removing for an unreadable server", async () => {
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    const item = within(row(unreadableServer.displayName));
    expect(item.getByText(/saved tokens can't be read/)).toBeInTheDocument();
    for (const name of ["Re-enter both tokens", "Rename", "Remove"]) expect(item.getByRole("button", { name })).toBeInTheDocument();
    expect(item.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  it("says a refused address isn't allowed, and warns about both tokens only for a LAN address", async () => {
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    const refused = within(row(refusedServer.displayName));
    expect(refused.getByText("This server's saved address isn't allowed. Edit the host or remove it.")).toBeInTheDocument();
    expect(refused.getByRole("button", { name: "Edit host" })).toBeInTheDocument();
    expect(refused.getByText(/token and data travel unencrypted/)).toHaveTextContent(/Both tokens/);
    // Loopback servers get no LAN warning.
    expect(within(row(okServer.displayName)).queryByText(/unencrypted/)).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing is stored", async () => {
    server.use(http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(managedServersEmpty)));
    renderView();
    expect(await screen.findByText(/No game servers yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a server" })).toBeInTheDocument();
  });

  it("shows the backend's refusal for a member who isn't the operator", async () => {
    server.use(http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(errorOperatorOnly, { status: 403 })));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the operator can manage servers.");
  });

  it("shows the API and FRM token hints for every combination the contract allows", async () => {
    const base = serverConnectionOk.server; // apiTokenLast4 "1a2b", frmTokenSet true, frmTokenLast4 "3c4d"
    const bothSuffixes = { ...base, id: "both-suffixes", displayName: "Both suffixes" };
    const noFrmToken = { ...base, id: "no-frm-token", displayName: "No FRM token", frmTokenSet: false, frmTokenLast4: null };
    const frmSetNoSuffix = { ...base, id: "frm-no-suffix", displayName: "FRM set no suffix", frmTokenLast4: null };
    const apiSetNoSuffix = { ...base, id: "api-no-suffix", displayName: "API set no suffix", apiTokenLast4: null };
    server.use(
      http.get(endpoints.serverManagement.list.route, () =>
        HttpResponse.json({ servers: [bothSuffixes, noFrmToken, frmSetNoSuffix, apiSetNoSuffix] }),
      ),
    );
    renderView();
    expect(await screen.findByText("API token ends in 1a2b · FRM token ends in 3c4d")).toBeInTheDocument();
    expect(within(row("No FRM token")).getByText("API token ends in 1a2b · no FRM token")).toBeInTheDocument();
    expect(within(row("FRM set no suffix")).getByText("API token ends in 1a2b · FRM token set")).toBeInTheDocument();
    expect(within(row("API set no suffix")).getByText("API token set · FRM token ends in 3c4d")).toBeInTheDocument();
  });

  it("tests a saved connection and reports each check", async () => {
    server.use(http.post(endpoints.serverManagement.testSaved.route, () => HttpResponse.json(testConnectionApiUnauthorized)));
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(okServer.displayName)).getByRole("button", { name: "Test connection" }));
    const result = await within(row(okServer.displayName)).findByText("Connection test failed.");
    expect(result.parentElement).toHaveTextContent("Game API: rejected the token");
    expect(result.parentElement).toHaveTextContent("FicsitRemoteMonitoring: OK");
  });
});

describe("ServerManagementView: removing", () => {
  it("asks first, says what happens, and removes on confirm", async () => {
    let removed = "";
    server.use(
      http.delete(endpoints.serverManagement.remove.route, ({ params }) => {
        removed = String(params.serverId);
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(okServer.displayName)).getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("group", { name: `Remove ${okServer.displayName}?` });
    expect(confirm).toHaveTextContent("its saved tokens are deleted");
    expect(confirm).not.toHaveTextContent(/history/i);
    expect(removed).toBe("");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove server" }));
    expect(await screen.findByText(`Removed ${okServer.displayName}.`)).toBeInTheDocument();
    expect(removed).toBe(okServer.id);
  });

  it("shows the backend's refusal when removing fails, and keeps the confirmation open", async () => {
    server.use(http.delete(endpoints.serverManagement.remove.route, () => HttpResponse.json(errorOperatorOnly, { status: 403 })));
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(okServer.displayName)).getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("group", { name: `Remove ${okServer.displayName}?` });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove server" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("Only the operator can manage servers.");
    // Still there: the row was not removed, and the confirmation is still open.
    expect(within(confirm).getByRole("button", { name: "Remove server" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: okServer.displayName })).toBeInTheDocument();
  });

  it("keeps the server when the operator changes their mind", async () => {
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(okServer.displayName)).getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

describe("ServerManagementView: adding", () => {
  async function openAdd() {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Add a server" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add a server" })).toHaveFocus());
  }

  function fillValid() {
    type("Server id", "second");
    type("Name", "Second world");
    type("Game API token", "api-token-value");
  }

  it("marks invalid fields from the shared schema and sends nothing", async () => {
    const bodies = capture("post", endpoints.serverManagement.create.route, () => HttpResponse.json({}));
    await openAdd();
    type("Server id", "Not Valid!");
    type("Game API port", "70000");
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(screen.getByLabelText("Server id")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Server id")).toHaveFocus();
    expect(screen.getByText("Enter a port from 1 to 65535.")).toBeInTheDocument();
    expect(screen.getByText("Enter a name of up to 64 characters.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it.each(["7777.5", "0x1F", "", "-1", "1e3"])(
    "rejects a port of %j instead of coercing it to a number",
    async (rawPort) => {
      const bodies = capture("post", endpoints.serverManagement.create.route, () => HttpResponse.json({}));
      await openAdd();
      fillValid();
      type("Game API port", rawPort);
      fireEvent.click(screen.getByRole("button", { name: "Add server" }));
      expect(screen.getByText("Enter a port from 1 to 65535.")).toBeInTheDocument();
      expect(bodies).toEqual([]);
    },
  );

  it("trims surrounding whitespace from a port before parsing it", async () => {
    const bodies = capture("post", endpoints.serverManagement.create.route, () =>
      HttpResponse.json({ server: { ...okServer, id: "second", displayName: "Second world" } }),
    );
    await openAdd();
    fillValid();
    type("Game API port", " 7777 ");
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    await screen.findByText("Added Second world.");
    expect(bodies).toEqual([
      { id: "second", displayName: "Second world", host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-value" },
    ]);
  });

  it("says a reserved id is reserved", async () => {
    await openAdd();
    fillValid();
    type("Server id", "managed");
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(screen.getByText("That id is reserved.")).toBeInTheDocument();
  });

  it("sends the new server, omitting a blank FRM token, and returns to the list", async () => {
    const bodies = capture("post", endpoints.serverManagement.create.route, () =>
      HttpResponse.json({ server: { ...okServer, id: "second", displayName: "Second world" } }),
    );
    await openAdd();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(await screen.findByText("Added Second world.")).toBeInTheDocument();
    expect(bodies).toEqual([
      { id: "second", displayName: "Second world", host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-value" },
    ]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Game servers" })).toHaveFocus());
  });

  it("tests the entered values without the id or name, and reports pass or fail", async () => {
    const bodies = capture("post", endpoints.serverManagement.testConnection.route, () =>
      HttpResponse.json(testConnectionFrmUnreachable),
    );
    await openAdd();
    fillValid();
    type("FRM token (optional)", "frm-token");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection test failed.")).toBeInTheDocument();
    expect(screen.getByText(/FicsitRemoteMonitoring: didn't answer/)).toBeInTheDocument();
    expect(bodies).toEqual([
      { host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-value", frmToken: "frm-token" },
    ]);
  });

  it("hints that only this machine works for a LAN IP, but never for a hostname", async () => {
    await openAdd();
    type("Host", "192.168.1.20");
    expect(screen.getByText("Only servers on this machine can be added for now.")).toBeInTheDocument();
    type("Host", "game-box");
    expect(screen.queryByText("Only servers on this machine can be added for now.")).not.toBeInTheDocument();
  });

  it.each([
    ["lan_requires_cert_pinning", 422, errorLanRequiresCertPinning, "Only servers on this machine can be added for now."],
    ["import_required", 409, errorImportRequired, errorImportRequired.error.message],
    ["connection_test_failed", 422, errorConnectionTestFailed, errorConnectionTestFailed.error.message],
  ] as const)("shows %s in plain words and stays on the form", async (_code, status, body, text) => {
    server.use(http.post(endpoints.serverManagement.create.route, () => HttpResponse.json(body, { status })));
    await openAdd();
    fillValid();
    type("Host", "game-box");
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Game API token")).toHaveValue("api-token-value");
  });

  it("cancels back to the list", async () => {
    await openAdd();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Game servers" })).toHaveFocus());
  });

  it("sends only one request for two submits that land before React re-renders, and shows no error", async () => {
    // save.isPending only updates on the next render; the pending-body ref is what drops the
    // second submit, before it can become a failed mutation shown as an error.
    const bodies = capture("post", endpoints.serverManagement.create.route, () =>
      HttpResponse.json({ server: { ...okServer, id: "second", displayName: "Second world" } }),
    );
    await openAdd();
    fillValid();
    const form = screen.getByRole("button", { name: "Add server" }).closest("form")!;
    // A single outer act() batches both submits before React flushes any state update, the same
    // way two fast physical clicks in a browser can both land before a re-render disables the button.
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await screen.findByText("Added Second world.");
    expect(bodies.length).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ServerManagementView: keeping tokens out of the mutation cache", () => {
  // LoginForm (src/auth/LoginForm.tsx) deliberately keeps the password out of `mutate()`'s
  // variables because TanStack Query keeps a mutation's variables in its cache for minutes
  // (see its comment). ServerForm's save and test-connection mutations pass the token straight
  // as `mutate(body)`, so it lands in `client.getMutationCache()` the same way the password would.
  async function openAdd(client: ReturnType<typeof renderView>["client"]) {
    fireEvent.click(await screen.findByRole("button", { name: "Add a server" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add a server" })).toHaveFocus());
    void client;
  }

  it("does not keep the API token in the mutation cache after adding a server", async () => {
    server.use(
      http.post(endpoints.serverManagement.create.route, () =>
        HttpResponse.json({ server: { ...okServer, id: "second", displayName: "Second world" } }),
      ),
    );
    const { client } = renderView();
    await openAdd(client);
    type("Server id", "second");
    type("Name", "Second world");
    type("Game API token", "secret-api-token");
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    await screen.findByText("Added Second world.");

    const mutations = client.getMutationCache().getAll();
    expect(mutations.length).toBeGreaterThan(0);
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain("secret-api-token");
  });

  it("does not keep the API token in the mutation cache after testing a new connection", async () => {
    server.use(http.post(endpoints.serverManagement.testConnection.route, () => HttpResponse.json(testConnectionApiUnauthorized)));
    const { client } = renderView();
    await openAdd(client);
    type("Server id", "second");
    type("Name", "Second world");
    type("Game API token", "secret-api-token");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("Connection test failed.");

    const mutations = client.getMutationCache().getAll();
    expect(mutations.length).toBeGreaterThan(0);
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain("secret-api-token");
  });

  it("does not keep a re-entered token in the mutation cache after editing a server", async () => {
    server.use(http.patch(endpoints.serverManagement.update.route, () => HttpResponse.json({ server: okServer })));
    const { client } = renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(okServer.displayName)).getByRole("button", { name: "Edit" }));
    type("Game API token", "secret-edit-token");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(`Saved ${okServer.displayName}.`);

    const mutations = client.getMutationCache().getAll();
    expect(mutations.length).toBeGreaterThan(0);
    expect(JSON.stringify(mutations.map((m) => m.state))).not.toContain("secret-edit-token");
  });
});

describe("ServerManagementView: editing", () => {
  async function openFor(serverName: string, button: string) {
    renderView();
    await screen.findByRole("list", { name: "Game servers" });
    fireEvent.click(within(row(serverName)).getByRole("button", { name: button }));
  }

  it("never prefills a token, shows only its suffix, and sends only what changed", async () => {
    const bodies = capture("patch", endpoints.serverManagement.update.route, () => HttpResponse.json({ server: okServer }));
    await openFor(okServer.displayName, "Edit");
    expect(screen.getByLabelText("Game API token")).toHaveValue("");
    expect(screen.getByLabelText("Game API token")).toHaveAttribute("type", "password");
    expect(screen.getByText("Set, ends in 1a2b. Leave blank to keep it.")).toBeInTheDocument();
    type("Game API port", "7780");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(`Saved ${okServer.displayName}.`)).toBeInTheDocument();
    expect(bodies).toEqual([{ apiPort: 7780 }]);
  });

  it("clears the FRM token with null when asked", async () => {
    const bodies = capture("patch", endpoints.serverManagement.update.route, () => HttpResponse.json({ server: okServer }));
    await openFor(okServer.displayName, "Edit");
    fireEvent.click(screen.getByLabelText(/Remove the FRM token/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(`Saved ${okServer.displayName}.`);
    expect(bodies).toEqual([{ frmToken: null }]);
  });

  it("sends nothing when nothing changed", async () => {
    const bodies = capture("patch", endpoints.serverManagement.update.route, () => HttpResponse.json({ server: okServer }));
    await openFor(okServer.displayName, "Edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Nothing to change.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("repairs an unreadable server with both tokens, a blank FRM token as null", async () => {
    const bodies = capture("patch", endpoints.serverManagement.update.route, () =>
      HttpResponse.json({ server: { ...unreadableServer, state: "ok" } }),
    );
    await openFor(unreadableServer.displayName, "Re-enter both tokens");
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    type("Game API token", "new-api-token");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(`Saved ${unreadableServer.displayName}.`);
    expect(bodies).toEqual([{ apiToken: "new-api-token", frmToken: null }]);
  });

  it("renames an unreadable server with only the name", async () => {
    const bodies = capture("patch", endpoints.serverManagement.update.route, () => HttpResponse.json({ server: unreadableServer }));
    await openFor(unreadableServer.displayName, "Rename");
    expect(screen.queryByLabelText("Game API token")).not.toBeInTheDocument();
    type("Name", "Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/^Saved /);
    expect(bodies).toEqual([{ displayName: "Renamed" }]);
  });

  it("shows connection_unreadable in plain words on the repair form, and stays on it", async () => {
    server.use(http.patch(endpoints.serverManagement.update.route, () => HttpResponse.json(errorConnectionUnreadable, { status: 409 })));
    await openFor(unreadableServer.displayName, "Re-enter both tokens");
    type("Game API token", "new-api-token");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorConnectionUnreadable.error.message);
    expect(screen.getByLabelText("Game API token")).toHaveValue("new-api-token");
  });

  it("shows connection_unreadable in plain words on the rename form too, even though renaming needs no tokens", async () => {
    server.use(http.patch(endpoints.serverManagement.update.route, () => HttpResponse.json(errorConnectionUnreadable, { status: 409 })));
    await openFor(unreadableServer.displayName, "Rename");
    type("Name", "Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorConnectionUnreadable.error.message);
    expect(screen.getByLabelText("Name")).toHaveValue("Renamed");
  });
});

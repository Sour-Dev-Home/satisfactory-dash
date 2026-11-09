import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorOperatorOnly, managedServersAllStates, renameAgentServerResponse } from "@satisfactory-dash/shared/fixtures";
import { managedAgentNone, managedAgentOne, managedAgentSeveral } from "../test/managedMocks";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { ServerManagementView } from "./ServerManagementView";

// ADR-0030 (the operator's Servers page) after ADR-0066: every server connects through the mod, so the list is the
// managed answer's agent servers, each renamed (#266) or removed. No direct-poll add, edit, test or switch back.

const [factoryTwo, creativeTest] = managedAgentSeveral.agentServers;

function serveManaged(body: unknown, status = 200) {
  server.use(http.get(endpoints.serverManagement.list.route, () => HttpResponse.json(body as object, { status })));
}

/** Records every body sent to the rename route and answers with `reply`. */
function captureRename(reply: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.patch(endpoints.serverManagement.renameAgent.route, async ({ request }) => {
      bodies.push(await request.json());
      return reply();
    }),
  );
  return bodies;
}

const renderView = () => renderWithClient(<ServerManagementView />);
const row = (name: string) => screen.getByRole("listitem", { name });
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ServerManagementView: the list", () => {
  it("lists one agent server, read through the mod, with Rename and Remove", async () => {
    serveManaged(managedAgentOne);
    renderView();
    const list = await screen.findByRole("list", { name: "Game servers" });
    const item = within(list).getByRole("listitem", { name: factoryTwo.displayName });
    expect(item).toHaveTextContent(`${factoryTwo.id} · read through the Satis Manager mod. The mod's status is on Settings.`);
    expect(within(item).getByRole("button", { name: `Rename ${factoryTwo.displayName}` })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: `Remove ${factoryTwo.displayName}` })).toBeInTheDocument();
    expect(item).not.toHaveTextContent(/agent/i);
  });

  it("lists several, each button named after its server, starting with the visible label (#305)", async () => {
    serveManaged(managedAgentSeveral);
    renderView();
    const list = await screen.findByRole("list", { name: "Game servers" });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-labelledby") && li.querySelector("h4")?.textContent)).toEqual([
      factoryTwo.displayName,
      creativeTest.displayName,
    ]);
    for (const button of within(row(creativeTest.displayName)).getAllByRole("button")) {
      expect(button.getAttribute("aria-label")).toMatch(new RegExp(`^${button.textContent}\\b.*${creativeTest.displayName}$`));
    }
  });

  it("shows an empty state when there are no agent servers, and offers no direct-poll Add a server", async () => {
    serveManaged(managedAgentNone);
    renderView();
    expect(await screen.findByText(/^No game servers yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a server" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("is the empty state too for an older backend that sends no agentServers (ADR-0007)", async () => {
    serveManaged({ servers: [] });
    renderView();
    expect(await screen.findByText(/^No game servers yet\./)).toBeInTheDocument();
  });

  // ADR-0066: the old backend still sends its stored direct-poll connections; nothing here can act on one, so they
  // are not shown, never mind the tokens' suffixes or a LAN warning.
  it("ignores stored connections the old backend still sends in `servers`", async () => {
    serveManaged({ ...managedServersAllStates, agentServers: managedAgentOne.agentServers });
    renderView();
    const list = await screen.findByRole("list", { name: "Game servers" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    for (const stored of managedServersAllStates.servers) expect(screen.queryByText(stored.displayName)).not.toBeInTheDocument();
    expect(screen.queryByText(/token|FRM port|Test connection|saved address/i)).not.toBeInTheDocument();
  });

  it("is the empty state when only stored connections are sent", async () => {
    serveManaged(managedServersAllStates);
    renderView();
    expect(await screen.findByText(/^No game servers yet\./)).toBeInTheDocument();
  });

  it("shows the backend's refusal for a member who isn't the operator", async () => {
    serveManaged(errorOperatorOnly, 403);
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the operator can manage servers.");
  });
});

describe("ServerManagementView: renaming", () => {
  it("renames one through its own route, with only the name", async () => {
    serveManaged(managedAgentOne);
    const bodies = captureRename(() => HttpResponse.json(renameAgentServerResponse));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    expect(screen.getByRole("heading", { name: `Rename server: ${factoryTwo.displayName}` })).toHaveFocus();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    type("Name", renameAgentServerResponse.server.displayName);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(`Saved ${renameAgentServerResponse.server.displayName}.`)).toBeInTheDocument();
    expect(bodies).toEqual([{ displayName: renameAgentServerResponse.server.displayName }]);
    expect(screen.getByRole("heading", { name: "Game servers" })).toHaveFocus();
  });

  it("says why a new name is refused, and sends nothing", async () => {
    serveManaged(managedAgentOne);
    const bodies = captureRename(() => HttpResponse.json(renameAgentServerResponse));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    type("Name", "Two​worlds");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/^A name is printable text/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    type("Name", "   ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("says nothing to change when the name is unchanged, and sends nothing", async () => {
    serveManaged(managedAgentOne);
    const bodies = captureRename(() => HttpResponse.json(renameAgentServerResponse));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Nothing to change.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("sends only one request for two submits that land before React re-renders", async () => {
    serveManaged(managedAgentOne);
    const bodies = captureRename(() => HttpResponse.json(renameAgentServerResponse));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    type("Name", renameAgentServerResponse.server.displayName);
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await screen.findByText(`Saved ${renameAgentServerResponse.server.displayName}.`);
    expect(bodies).toHaveLength(1);
  });

  it("shows the backend's refusal and stays on the form", async () => {
    serveManaged(managedAgentOne);
    captureRename(() => HttpResponse.json(errorOperatorOnly, { status: 403 }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    type("Name", "Another name");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the operator can manage servers.");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("cancels back to the list", async () => {
    serveManaged(managedAgentOne);
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${factoryTwo.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("list", { name: "Game servers" })).toBeInTheDocument();
  });
});

describe("ServerManagementView: removing", () => {
  it("asks first, says what happens, and removes on confirm", async () => {
    serveManaged(managedAgentOne);
    let removed = "";
    server.use(
      http.delete(endpoints.serverManagement.remove.route, ({ params }) => {
        removed = String(params.serverId);
        return HttpResponse.json({ deleted: true });
      }),
    );
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${factoryTwo.displayName}` }));
    const confirm = screen.getByRole("group", { name: `Remove ${factoryTwo.displayName}?` });
    // Only what the backend really does: removing a server deletes its recorded history too (#193).
    expect(confirm).toHaveTextContent("its recorded history is erased. The game and its saves are never touched.");
    expect(confirm).toHaveTextContent("the mod's connection stops working");
    expect(confirm).not.toHaveTextContent(/delet|token/i);
    expect(removed).toBe("");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove server" }));
    expect(await screen.findByText(`Removed ${factoryTwo.displayName}.`)).toBeInTheDocument();
    expect(removed).toBe(factoryTwo.id);
  });

  it("shows the backend's refusal when removing fails, and keeps the confirmation open", async () => {
    serveManaged(managedAgentOne);
    server.use(http.delete(endpoints.serverManagement.remove.route, () => HttpResponse.json(errorOperatorOnly, { status: 403 })));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${factoryTwo.displayName}` }));
    const confirm = screen.getByRole("group", { name: `Remove ${factoryTwo.displayName}?` });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove server" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("Only the operator can manage servers.");
    expect(within(confirm).getByRole("button", { name: "Remove server" })).toBeInTheDocument();
    expect(row(factoryTwo.displayName)).toBeInTheDocument();
  });

  it("keeps the server when the operator changes their mind, and a reopened confirm shows no old error", async () => {
    serveManaged(managedAgentOne);
    server.use(http.delete(endpoints.serverManagement.remove.route, () => HttpResponse.json(errorOperatorOnly, { status: 403 })));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${factoryTwo.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: "Remove server" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Remove ${factoryTwo.displayName}` }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

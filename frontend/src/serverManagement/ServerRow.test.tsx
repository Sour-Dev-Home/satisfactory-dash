import { describe, expect, it, vi } from "vitest";
import type { ServerConnection } from "@satisfactory-dash/shared";
import { managedServersAllStates } from "@satisfactory-dash/shared/fixtures";
import { renderWithClient } from "../test/render";
import { ServerRow } from "./ServerRow";

const [okServer, unreadableServer, refusedServer] = managedServersAllStates.servers;

function renderRow(server: ServerConnection) {
  return renderWithClient(<ServerRow server={server} onEdit={vi.fn()} onRemoved={vi.fn()} />);
}

/** The state note, if any: a <p> distinct from the "Re-enter both tokens" button's own label. */
const note = () => document.querySelector("p.text-warn");

describe("ServerRow", () => {
  it("shows no note for a healthy connection", () => {
    renderRow(okServer);
    expect(note()).not.toBeInTheDocument();
  });

  it("names the fix for an unreadable connection", () => {
    renderRow(unreadableServer);
    expect(note()).toHaveTextContent(/Re-enter both tokens/);
  });

  it("names the fix for a refused address", () => {
    renderRow(refusedServer);
    expect(note()).toHaveTextContent(/isn't allowed/);
  });

  // #368: `state` is validated against a closed schema enum today, but the lookup itself reads
  // own keys only, so a state this build has never seen (including an inherited name like
  // "toString") shows no note instead of rendering `Object.prototype.toString` as a child.
  it("shows no note, and doesn't crash, for a state this build doesn't know", () => {
    const server = { ...okServer, state: "toString" } as unknown as ServerConnection;
    renderRow(server);
    expect(note()).not.toBeInTheDocument();
  });
});

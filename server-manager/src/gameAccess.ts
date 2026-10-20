/**
 * How the clean stop gets the game's API (ADR-0040): the agent's own store, opened fresh each time, gives the game's host,
 * port and application token (the token is a DPAPI blob only the agent's Windows user can unprotect). The token goes
 * straight into createGameApi and nowhere else: what comes back to the supervisor, and so to the window, is either the
 * API or a reason in plain words, and a reason never carries the token.
 */
import { AgentStore, createDpapi, resolveDataDir } from "@satisfactory-dash/agent";
import { createGameApi, redact, type GameApi } from "./gameApi";
import type { GameApiAccess } from "./supervisor";

/** The slice of the agent's store this reads. */
export interface GameStore {
  readonly game: { host: string; apiPort: number };
  getSecret(name: "apiToken"): Promise<string | undefined>;
}

export const NEEDS_AGENT =
  "The clean stop needs the agent set up: it saves the game through the server's API with the agent's API token, and the agent has none stored.";

export function openAgentStore(): GameStore {
  return AgentStore.open(resolveDataDir(), createDpapi());
}

export async function gameApiAccess(deps: {
  openStore: () => GameStore;
  createApi?: (opts: { host: string; port: number; token: string }) => GameApi;
}): Promise<GameApiAccess> {
  let store: GameStore;
  try {
    store = deps.openStore();
  } catch (err) {
    return { ok: false, reason: `The clean stop couldn't read the agent's store (${message(err)}).` };
  }
  let token: string | undefined;
  try {
    token = await store.getSecret("apiToken");
  } catch (err) {
    // A DpapiError's text never holds what it decrypted (agent/src/dpapi.ts), and nothing was decrypted here.
    return { ok: false, reason: `The clean stop couldn't read the agent's API token (${message(err)}).` };
  }
  if (token === undefined || token === "") return { ok: false, reason: NEEDS_AGENT };
  const create = deps.createApi ?? createGameApi;
  const { host, apiPort } = store.game;
  try {
    return { ok: true, api: create({ host, port: apiPort, token }) };
  } catch (err) {
    return { ok: false, reason: `The clean stop couldn't set up the game's API (${redact(message(err), token)}).` };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentStore, type Dpapi } from "@satisfactory-dash/agent";
import { describe, expect, it } from "vitest";
import { gameApiAccess, NEEDS_AGENT, type GameStore } from "./gameAccess";
import type { GameApi } from "./gameApi";

const TOKEN = "secret-app-token";

function store(opts: { token?: string; secretError?: Error } = {}): GameStore {
  return {
    game: { host: "127.0.0.1", apiPort: 7777 },
    async getSecret(name) {
      expect(name).toBe("apiToken");
      if (opts.secretError) throw opts.secretError;
      return opts.token;
    },
  };
}

const fakeApi: GameApi = {
  saveGame: async () => undefined,
  shutdown: async () => undefined,
  sessionName: async () => "w",
};

describe("gameApiAccess", () => {
  it("builds the API from the store's host, port and token", async () => {
    const seen: unknown[] = [];
    const access = await gameApiAccess({
      openStore: () => store({ token: TOKEN }),
      createApi: (opts) => {
        seen.push(opts);
        return fakeApi;
      },
    });
    expect(access).toEqual({ ok: true, api: fakeApi });
    expect(seen).toEqual([{ host: "127.0.0.1", port: 7777, token: TOKEN }]);
  });

  it("with no token stored, says the clean stop needs the agent set up", async () => {
    const access = await gameApiAccess({ openStore: () => store(), createApi: () => fakeApi });
    expect(access).toEqual({ ok: false, reason: NEEDS_AGENT });
    expect(NEEDS_AGENT).toContain("needs the agent set up");
  });

  it("edge: an empty token is no token", async () => {
    await expect(gameApiAccess({ openStore: () => store({ token: "" }) })).resolves.toEqual({ ok: false, reason: NEEDS_AGENT });
  });

  it("edge: a store that can't be opened or a token that can't be decrypted is a reason, not a throw", async () => {
    const open = await gameApiAccess({
      openStore: () => {
        throw new Error("store.json is not valid JSON");
      },
    });
    expect(open).toEqual({ ok: false, reason: expect.stringContaining("not valid JSON") });
    const dpapi = await gameApiAccess({ openStore: () => store({ secretError: new Error("DPAPI unavailable") }) });
    expect(dpapi).toEqual({ ok: false, reason: expect.stringContaining("DPAPI unavailable") });
  });

  it("edge: an error setting up the API never carries the token", async () => {
    const access = await gameApiAccess({
      openStore: () => store({ token: TOKEN }),
      createApi: () => {
        throw new Error(`bad header ${TOKEN}`);
      },
    });
    expect(access.ok).toBe(false);
    expect(JSON.stringify(access)).not.toContain(TOKEN);
  });

  it("reads the agent's real store format: no store file means no token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-agent-"));
    try {
      const dpapi: Dpapi = {
        protect: async () => {
          throw new Error("not used");
        },
        unprotect: async () => {
          throw new Error("not used");
        },
      };
      await expect(gameApiAccess({ openStore: () => AgentStore.open(dir, dpapi) })).resolves.toEqual({
        ok: false,
        reason: NEEDS_AGENT,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

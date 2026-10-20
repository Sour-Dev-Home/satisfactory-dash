import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { anywayRequested, CHANNELS, type AgentStatus, type ServerManagerBridge, type Status } from "./ipc";

/**
 * The window's whole reach is the bridge the preload exposes. These tests pin that surface, so a way to get the game's
 * API token (a method, a channel, a Status field) can't be added without one of them failing.
 */
const exposed = vi.hoisted(() => ({ bridge: undefined as unknown, invokes: [] as { channel: string; args: unknown[] }[] }));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      expect(name).toBe("serverManager");
      exposed.bridge = api;
    },
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      exposed.invokes.push({ channel, args });
      return undefined;
    },
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

await import("./preload");
const bridge = exposed.bridge as ServerManagerBridge;

const TOKEN_WORDS = /token|secret|password|credential|dpapi|store|key|auth/i;

describe("the renderer's IPC surface", () => {
  it("is exactly these methods, none of which names a token", () => {
    expect(Object.keys(bridge).sort()).toEqual(
      [
        "chooseServerDir",
        "chooseSteamcmdDir",
        "getStatus",
        "onStatus",
        "onUpdateLine",
        "restart",
        "start",
        "stop",
        "update",
        "getAgentStatus",
        "onAgentStatus",
        "startAgent",
        "stopAgent",
        "runAgentCommand",
        "openAgentRunbook",
      ].sort(),
    );
    for (const name of Object.keys(bridge)) expect(name).not.toMatch(TOKEN_WORDS);
  });

  it("uses only the known channels, and no channel names a token", async () => {
    const known = new Set<string>(Object.values(CHANNELS));
    for (const value of known) expect(value).not.toMatch(TOKEN_WORDS);
    exposed.invokes = [];
    await bridge.getStatus();
    await bridge.start();
    await bridge.stop();
    await bridge.restart();
    await bridge.update();
    await bridge.chooseServerDir();
    await bridge.chooseSteamcmdDir();
    await bridge.getAgentStatus();
    await bridge.startAgent();
    await bridge.stopAgent();
    await bridge.runAgentCommand("status");
    await bridge.openAgentRunbook();
    expect(exposed.invokes.map((i) => i.channel).every((c) => known.has(c))).toBe(true);
  });

  it("passes on only an allowed agent command, and the runbook link as an intent with no URL", async () => {
    exposed.invokes = [];
    await bridge.runAgentCommand("check");
    await bridge.runAgentCommand("set-tokens" as never);
    await bridge.runAgentCommand({ toString: () => "check" } as never);
    await bridge.openAgentRunbook();
    await bridge.startAgent();
    await bridge.stopAgent();
    expect(exposed.invokes.map((i) => i.args)).toEqual([["check"], [undefined], [undefined], [], [], []]);
  });

  it("no AgentStatus field can hold a token", () => {
    const keys: (keyof AgentStatus)[] = ["task", "log", "halted", "busy"];
    for (const key of keys) expect(key).not.toMatch(TOKEN_WORDS);
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const body = /function agentStatus\(\): AgentStatus \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(body).not.toBe("");
    const filled = [...body.matchAll(/^\s{4}(\w+)[:,]/gm)].map((m) => m[1]);
    expect(filled.sort()).toEqual([...keys].sort());
  });

  it("main opens only the one fixed runbook address", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const opens = [...main.matchAll(/openExternal\(([^)]*)\)/g)].map((m) => m[1]);
    expect(opens).toEqual(["AGENT_RUNBOOK_URL"]);
    expect(main).toMatch(
      /const AGENT_RUNBOOK_URL =\s*"https:\/\/github\.com\/Sour-Dev-Home\/satisfactory-dash\/blob\/main\/docs-vault\/wiki\/runbooks\/agent-app\.md#keeping-it-running-a-scheduled-task";/,
    );
  });

  it("passes on only the anyway flag, never what the page put beside it", async () => {
    exposed.invokes = [];
    await bridge.stop({ anyway: true, extra: "x" } as never);
    await bridge.restart({ anyway: "yes" } as never);
    await bridge.update();
    expect(exposed.invokes.map((i) => i.args)).toEqual([[{ anyway: true }], [undefined], [undefined]]);
  });

  it("no Status field can hold a token", () => {
    // The keys the main process fills (main.ts status()); a new field must be added here, and must not be a secret.
    const keys: (keyof Status)[] = [
      "state",
      "lastError",
      "leftoverPid",
      "configured",
      "serverDir",
      "steamcmdDir",
      "uptimeMs",
      "cpuPercent",
      "memoryBytes",
      "anyway",
      "updating",
      "updateResult",
    ];
    for (const key of keys) expect(key).not.toMatch(TOKEN_WORDS);
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const body = /function status\(\): Status \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(body).not.toBe("");
    const filled = [...body.matchAll(/^\s{4}(\w+)[:,]/gm)].map((m) => m[1]);
    expect(filled.sort()).toEqual([...keys].sort());
  });

  it("main reads the token only to hand it to the game API, never into a message to the window", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/getSecret|apiToken/);
    expect(main).not.toMatch(/console\.(log|error|warn|info)\([^)]*(token|secret)/i);
  });
});

describe("anywayRequested", () => {
  it("is true only for a literal anyway: true", () => {
    expect(anywayRequested({ anyway: true })).toBe(true);
    for (const arg of [undefined, null, true, "anyway", { anyway: "true" }, { anyway: 1 }, {}, []]) {
      expect(anywayRequested(arg)).toBe(false);
    }
  });
});

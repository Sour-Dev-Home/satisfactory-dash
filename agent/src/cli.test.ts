import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@satisfactory-dash/game-adapter";
import { agentEnrollResponse, playersAvailable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { EXIT_CREDENTIAL_REJECTED, EXIT_FAILED, EXIT_OK, EXIT_STORE, runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { DpapiError } from "./dpapi.js";
import type { Dpapi } from "./dpapi.js";
import type { GameReader } from "./sampler.js";
import { PromptAborted } from "./prompt.js";
import { AgentStore } from "./store.js";

const API_TOKEN = "api-token-VALUE-0123456789abcdef";
const FRM_TOKEN = "frm-token-VALUE-fedcba9876543210";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sd-agent-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeDpapi(): Dpapi & { fail: boolean } {
  return {
    fail: false,
    async protect(plaintext) {
      return Buffer.from(`P:${plaintext}`, "utf8").toString("hex");
    },
    async unprotect(blob) {
      if (this.fail) throw new DpapiError("unprotect_failed", "Windows could not unprotect the agent's store. Run the agent as the same Windows user that set it up (test).");
      return Buffer.from(blob, "hex").toString("utf8").replace(/^P:/, "");
    },
  };
}

function reader(overrides: Partial<GameReader> = {}): GameReader {
  return {
    readStatus: vi.fn(async () => ({ ...statusRunning.data, sessionName: "Secret Save Name" })),
    readPower: vi.fn(async () => ({ circuits: [] })),
    readFactory: vi.fn(async () => ({ buildings: [] })),
    readPlayers: vi.fn(async () => ({ available: true, players: [{ name: "Alice the Builder", online: true }] })),
    readAutoPause: vi.fn(async () => true),
    applyAutoPause: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setup(over: Partial<CliDeps> & { answers?: string[]; dpapi?: Dpapi & { fail: boolean } } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const answers = [...(over.answers ?? [])];
  const dpapi = over.dpapi ?? fakeDpapi();
  const deps: CliDeps = {
    env: { SD_AGENT_HOME: dir },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    dpapi,
    prompt: async (question) => {
      questions.push(question);
      const next = answers.shift();
      if (next === undefined) throw new PromptAborted();
      return next;
    },
    signal: new AbortController().signal,
    ...over,
  };
  return { deps, out, err, questions, dpapi, all: () => [...out, ...err].join("\n") };
}
const store = (dpapi: Dpapi) => AgentStore.open(dir, dpapi);
const fileText = () => readFileSync(path.join(dir, "store.json"), "utf8");

describe("usage", () => {
  it("prints help, the version, and refuses an unknown command", async () => {
    const t = setup();
    expect(await runCli(["--help"], t.deps)).toBe(EXIT_OK);
    expect(t.out.join("\n")).toContain("set-tokens, check, enroll, run");
    expect(await runCli(["--version"], t.deps)).toBe(EXIT_OK);
    expect(t.out.at(-1)).toBe("0.1.0");
    expect(await runCli([], t.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["frobnicate"], t.deps)).toBe(EXIT_FAILED);
    expect(t.err.join("\n")).toContain("Unknown command.");
    expect(t.err.join("\n")).not.toContain("frobnicate"); // what was typed is not echoed back
  });
});

describe("set-tokens (architect rule 3: a hidden prompt, never argv)", () => {
  it("asks for both tokens at a prompt, stores them ONLY as protected blobs, and never prints them", async () => {
    const t = setup({ answers: [API_TOKEN, FRM_TOKEN] });
    expect(await runCli(["set-tokens"], t.deps)).toBe(EXIT_OK);
    expect(t.questions).toEqual(["Game API token (input hidden): ", "FicsitRemoteMonitoring token (input hidden; press Enter if there is none): "]);
    for (const value of [API_TOKEN, FRM_TOKEN]) {
      expect(fileText()).not.toContain(value);
      expect(t.all()).not.toContain(value);
    }
    const opened = store(t.dpapi);
    expect(await opened.getSecret("apiToken")).toBe(API_TOKEN);
    expect(await opened.getSecret("frmToken")).toBe(FRM_TOKEN);
  });

  it("a blank FRM token means none (and clears an old one); a blank API token saves nothing", async () => {
    const t = setup({ answers: [API_TOKEN, FRM_TOKEN] });
    await runCli(["set-tokens"], t.deps);
    const again = setup({ answers: [API_TOKEN, ""], dpapi: t.dpapi });
    await runCli(["set-tokens"], again.deps);
    expect(store(t.dpapi).hasSecret("frmToken")).toBe(false);
    const empty = setup({ answers: ["   "] });
    rmSync(path.join(dir, "store.json"));
    expect(await runCli(["set-tokens"], empty.deps)).toBe(EXIT_FAILED);
    expect(existsSync(path.join(dir, "store.json"))).toBe(false); // nothing at all was saved: ask first, save after
    expect(store(t.dpapi).hasSecret("apiToken")).toBe(false);
  });

  it("refuses a token or secret on the command line, and never echoes what was given", async () => {
    for (const arg of ["--api-token=SUPERSECRET123", "--token", "--frm-token", "--secret=abc", "--password=x"]) {
      const t = setup({ answers: [API_TOKEN, ""] });
      expect(await runCli(["set-tokens", arg], t.deps), arg).toBe(EXIT_FAILED);
      expect(t.err.join("\n")).toContain("never accepted on the command line");
      expect(t.all()).not.toContain("SUPERSECRET123");
      expect(t.questions).toEqual([]); // it did not even ask
    }
  });

  it("takes the game's host and ports as plain flags, and refuses a host that is not this machine or its own network", async () => {
    const ok = setup({ answers: [API_TOKEN, ""] });
    expect(await runCli(["set-tokens", "--host", "192.168.1.20", "--api-port", "7778", "--frm-port=8081"], ok.deps)).toBe(EXIT_OK);
    expect(store(ok.dpapi).game).toEqual({ host: "192.168.1.20", apiPort: 7778, frmPort: 8081 });
    const bad = setup({ answers: [API_TOKEN, ""] });
    expect(await runCli(["set-tokens", "--host", "example.com"], bad.deps)).toBe(EXIT_STORE);
    expect(bad.err.join("\n")).toContain("never a public one");
    const port = setup({ answers: [API_TOKEN, ""] });
    expect(await runCli(["set-tokens", "--api-port", "99999"], port.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["set-tokens", "--nope"], port.deps)).toBe(EXIT_FAILED);
  });

  it("Ctrl+C at the prompt saves nothing", async () => {
    const t = setup({ answers: [] });
    expect(await runCli(["set-tokens"], t.deps)).toBe(EXIT_FAILED);
    expect(t.err.join("\n")).toContain("Nothing was saved");
  });
});

describe("check (the game read over loopback, before enrolling)", () => {
  async function withTokens() {
    const t = setup({ answers: [API_TOKEN, FRM_TOKEN] });
    await runCli(["set-tokens"], t.deps);
    return t.dpapi;
  }

  it("needs the tokens first", async () => {
    const t = setup({ connect: () => reader() });
    expect(await runCli(["check"], t.deps)).toBe(EXIT_FAILED);
    expect(t.err.join("\n")).toContain("agent set-tokens");
  });

  it("reports what works with counts only: no save name, no player name, no token", async () => {
    const dpapi = await withTokens();
    const connect = vi.fn(() => reader());
    const t = setup({ dpapi, connect });
    expect(await runCli(["check"], t.deps)).toBe(EXIT_OK);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ apiToken: API_TOKEN, frmToken: FRM_TOKEN, host: "127.0.0.1" }));
    const text = t.all();
    expect(text).toContain("status      ok (game running");
    expect(text).toContain("players     ok (1 listed)");
    expect(text).toContain("auto-pause  ok (readable, on)");
    expect(text).toContain("Next: agent enroll");
    for (const leaked of ["Secret Save Name", "Alice", "Builder", API_TOKEN, FRM_TOKEN]) expect(text, leaked).not.toContain(leaked);
    void playersAvailable;
  });

  it("a failing read is a CODE, never the error text, and the check fails", async () => {
    const dpapi = await withTokens();
    const t = setup({
      dpapi,
      connect: () =>
        reader({
          readPower: vi.fn(async () => Promise.reject(new UpstreamError(`connect ECONNREFUSED 127.0.0.1 with token ${API_TOKEN}`, { failureKind: "unreachable" }))),
          readAutoPause: vi.fn(async () => Promise.reject(new UpstreamError("nope", { status: 403 }))),
        }),
    });
    expect(await runCli(["check"], t.deps)).toBe(EXIT_FAILED);
    expect(t.all()).toContain("power       FAILED (upstream_unreachable)");
    expect(t.all()).toContain("auto-pause  FAILED (upstream_auth_rejected)");
    expect(t.all()).toContain("2 check(s) failed");
    expect(t.all()).not.toContain(API_TOKEN);
    expect(t.all()).not.toContain("ECONNREFUSED");
  });

  it("FRM being absent is not a failure (the dashboard falls back to counts)", async () => {
    const dpapi = await withTokens();
    const t = setup({ dpapi, connect: () => reader({ readPlayers: vi.fn(async () => ({ available: false, players: [] })) }) });
    expect(await runCli(["check"], t.deps)).toBe(EXIT_OK);
    expect(t.all()).toContain("players     not available");
  });
});

describe("enroll", () => {
  const enrollOk: CliDeps["fetch"] = async () => new Response(JSON.stringify(agentEnrollResponse), { status: 201, headers: { "content-type": "application/json" } });
  async function withTokens() {
    const t = setup({ answers: [API_TOKEN, ""] });
    await runCli(["set-tokens"], t.deps);
    return t.dpapi;
  }

  it("trades the code for the credential, stores it protected, and never prints it (runbook order: tokens first)", async () => {
    const dpapi = await withTokens();
    const t = setup({ dpapi, fetch: enrollOk });
    expect(await runCli(["enroll", "ab3d-7xq2", "--url", "https://api.example.test"], t.deps)).toBe(EXIT_OK);
    const opened = store(dpapi);
    expect(await opened.getSecret("agentSecret")).toBe(agentEnrollResponse.agentSecret);
    expect([opened.backendUrl, opened.serverId]).toEqual(["https://api.example.test", "default"]);
    expect(fileText()).not.toContain(agentEnrollResponse.agentSecret);
    expect(t.all()).not.toContain(agentEnrollResponse.agentSecret);
  });

  it("refuses to enrol before the game's tokens are set (enrolling deletes the backend's stored tokens row)", async () => {
    const t = setup({ fetch: vi.fn() as never });
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], t.deps)).toBe(EXIT_FAILED);
    expect(t.err.join("\n")).toContain("agent check");
    expect(t.err.join("\n")).toContain("forget any game token");
  });

  it("validates the code's shape, needs a URL, and the URL must be https (http only for localhost)", async () => {
    const dpapi = await withTokens();
    const fetchSpy = vi.fn(enrollOk);
    const t = setup({ dpapi, fetch: fetchSpy });
    expect(await runCli(["enroll", "not-a-code", "--url", "https://api.example.test"], t.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["enroll", "AB3D-7XQ2"], t.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "http://api.example.test"], t.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://user:pw@api.example.test"], t.deps)).toBe(EXIT_FAILED);
    expect(await runCli(["enroll"], t.deps)).toBe(EXIT_FAILED);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(t.all()).not.toContain("pw@");
  });

  it("does not silently replace a credential: --replace is required", async () => {
    const dpapi = await withTokens();
    await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], setup({ dpapi, fetch: enrollOk }).deps);
    const again = setup({ dpapi, fetch: enrollOk });
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], again.deps)).toBe(EXIT_FAILED);
    expect(again.err.join("\n")).toContain("--replace");
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test", "--replace"], again.deps)).toBe(EXIT_OK);
  });

  it("explains an invalid, used or expired code; other failures keep the client's own safe message", async () => {
    const dpapi = await withTokens();
    const invalid = setup({ dpapi, fetch: async () => new Response(JSON.stringify({ error: { code: "enrollment_code_invalid", message: "x", requestId: "r" } }), { status: 400 }) });
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], invalid.deps)).toBe(EXIT_FAILED);
    expect(invalid.err.join("\n")).toContain("wrong, already used or expired");
    const down = setup({ dpapi, fetch: async () => Promise.reject(new TypeError("ECONNREFUSED")) });
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], down.deps)).toBe(EXIT_FAILED);
    expect(down.err.join("\n")).toContain("could not be reached");
    expect(down.err.join("\n")).not.toContain("ECONNREFUSED");
    expect(store(dpapi).hasSecret("agentSecret")).toBe(false);
  });
});

describe("run", () => {
  async function enrolled() {
    const t = setup({ answers: [API_TOKEN, FRM_TOKEN] });
    await runCli(["set-tokens"], t.deps);
    await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], setup({ dpapi: t.dpapi, fetch: async () => new Response(JSON.stringify(agentEnrollResponse), { status: 201 }) }).deps);
    return t.dpapi;
  }

  it("is refused until enrolled", async () => {
    const t = setup({ runAgent: vi.fn() as never });
    expect(await runCli(["run"], t.deps)).toBe(EXIT_FAILED);
    expect(t.err.join("\n")).toContain("not enrolled");
  });

  it("FAILS LOUDLY when the store cannot be unprotected (wrong Windows user or logon type): a clear message, exit 3, nothing started", async () => {
    const dpapi = await enrolled();
    dpapi.fail = true;
    const started = vi.fn();
    const t = setup({ dpapi, runAgent: started as never });
    expect(await runCli(["run"], t.deps)).toBe(EXIT_STORE);
    expect(t.err.join("\n")).toContain("same Windows user");
    expect(started).not.toHaveBeenCalled();
  });

  it("starts the agent with the game reader and the backend client from the store, and a log that scrubs every secret", async () => {
    const dpapi = await enrolled();
    const connect = vi.fn(() => reader());
    const started = vi.fn(async (options: { logger: { info(event: string, fields?: Record<string, string>): void } }) => {
      options.logger.info("hello", { note: agentEnrollResponse.agentSecret });
      options.logger.info("hello", { note: API_TOKEN });
      return "stopped" as const;
    });
    const t = setup({ dpapi, connect, runAgent: started as never });
    expect(await runCli(["run"], t.deps)).toBe(EXIT_OK);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ apiToken: API_TOKEN, frmToken: FRM_TOKEN }));
    expect(started).toHaveBeenCalledTimes(1);
    const logFiles = readdirSync(path.join(dir, "logs"));
    expect(logFiles).toHaveLength(1);
    const log = readFileSync(path.join(dir, "logs", logFiles[0]!), "utf8");
    expect(log).toContain("hello");
    expect(log).not.toContain(agentEnrollResponse.agentSecret);
    expect(log).not.toContain(API_TOKEN);
    expect(t.all()).not.toContain(API_TOKEN);
  });

  it("a rejected credential ends with exit 2 and tells the owner exactly how to enrol again", async () => {
    const dpapi = await enrolled();
    const t = setup({ dpapi, connect: () => reader(), runAgent: (async () => "auth_rejected") as never });
    expect(await runCli(["run"], t.deps)).toBe(EXIT_CREDENTIAL_REJECTED);
    expect(t.err.join("\n")).toContain("will not retry");
    expect(t.err.join("\n")).toContain("--replace");
  });
});

describe("status and forget-credential", () => {
  it("status shows what is set (never a value) and that the store opens", async () => {
    const t = setup({ answers: [API_TOKEN, ""] });
    await runCli(["set-tokens"], t.deps);
    const s = setup({ dpapi: t.dpapi });
    expect(await runCli(["status"], s.deps)).toBe(EXIT_OK);
    expect(s.out.join("\n")).toContain("apiToken:     stored, readable by this user");
    expect(s.out.join("\n")).toContain("agentSecret:  not set");
    expect(s.all()).not.toContain(API_TOKEN);
  });

  it("status says clearly when a stored secret cannot be unprotected, with exit 3", async () => {
    const t = setup({ answers: [API_TOKEN, ""] });
    await runCli(["set-tokens"], t.deps);
    t.dpapi.fail = true;
    const s = setup({ dpapi: t.dpapi });
    expect(await runCli(["status"], s.deps)).toBe(EXIT_STORE);
    expect(s.all()).toContain("CANNOT be unprotected");
  });

  it("forget-credential removes only the agent's credential", async () => {
    const t = setup({ answers: [API_TOKEN, ""] });
    await runCli(["set-tokens"], t.deps);
    await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], setup({ dpapi: t.dpapi, fetch: async () => new Response(JSON.stringify(agentEnrollResponse), { status: 201 }) }).deps);
    expect(await runCli(["forget-credential"], setup({ dpapi: t.dpapi }).deps)).toBe(EXIT_OK);
    const opened = store(t.dpapi);
    expect([opened.hasSecret("agentSecret"), opened.hasSecret("apiToken")]).toEqual([false, true]);
  });
});

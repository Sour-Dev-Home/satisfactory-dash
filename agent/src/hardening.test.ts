import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentEnrollResponse, agentSnapshotResponse } from "@satisfactory-dash/shared/fixtures";
import { BackendClient, BackendError } from "./backendClient.js";
import { EXIT_CREDENTIAL_REJECTED, EXIT_FAILED, EXIT_OK, EXIT_STORE, runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { DpapiError } from "./dpapi.js";
import type { Dpapi } from "./dpapi.js";
import { clearHalted, readHalted, writeHalted } from "./halted.js";
import { AgentStore, StoreError } from "./store.js";

/** Security review findings on the agent (ADR-0031 PR 6): a halted marker, a streamed size cap, a host re-check, and more. */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sd-agent-hard-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const API_TOKEN = "api-token-VALUE-0123456789abcdef";
function fakeDpapi(): Dpapi & { failProtect: boolean; failUnprotect: boolean } {
  return {
    failProtect: false,
    failUnprotect: false,
    async protect(plaintext) {
      if (this.failProtect) throw new DpapiError("protect_failed", "Windows could not protect a secret (test).");
      return Buffer.from(`P:${plaintext}`, "utf8").toString("hex");
    },
    async unprotect(blob) {
      if (this.failUnprotect) throw new DpapiError("unprotect_failed", "Windows could not unprotect the agent's store (test).");
      return Buffer.from(blob, "hex").toString("utf8").replace(/^P:/, "");
    },
  };
}
function cli(over: Partial<CliDeps> & { answers?: string[]; dpapi?: ReturnType<typeof fakeDpapi> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const answers = [...(over.answers ?? [])];
  const dpapi = over.dpapi ?? fakeDpapi();
  const deps: CliDeps = { env: { SD_AGENT_HOME: dir }, out: (line) => out.push(line), err: (line) => err.push(line), dpapi, prompt: async () => answers.shift() ?? "", signal: new AbortController().signal, ...over };
  return { deps, out, err, dpapi };
}
const enrollFetch: CliDeps["fetch"] = async () => new Response(JSON.stringify(agentEnrollResponse), { status: 201 });
async function enrolled() {
  const first = cli({ answers: [API_TOKEN, ""] });
  await runCli(["set-tokens"], first.deps);
  await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], cli({ dpapi: first.dpapi, fetch: enrollFetch }).deps);
  return first.dpapi;
}

describe("the halted marker (a Scheduled Task must not restart a permanent failure forever)", () => {
  it("a rejected credential exits 2 ONCE, writes the marker, and every later start says why and ends with SUCCESS without starting anything", async () => {
    const dpapi = await enrolled();
    const runAgent = vi.fn(async () => "auth_rejected" as const);
    const first = cli({ dpapi, runAgent: runAgent as never, connect: () => ({}) as never });
    expect(await runCli(["run"], first.deps)).toBe(EXIT_CREDENTIAL_REJECTED);
    expect(readHalted(dir)?.reason).toBe("credential_rejected");

    const again = cli({ dpapi, runAgent: runAgent as never, connect: vi.fn() as never });
    expect(await runCli(["run"], again.deps)).toBe(EXIT_OK); // success: a restart-on-failure policy stops here
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(again.err.join("\n")).toContain("agent enroll <CODE>");
    expect(again.err.join("\n")).toContain("--replace");
  });

  it("a store that cannot be unprotected exits 3 ONCE, writes the marker, and later starts do not touch DPAPI again", async () => {
    const dpapi = await enrolled();
    dpapi.failUnprotect = true;
    const first = cli({ dpapi, runAgent: vi.fn() as never });
    expect(await runCli(["run"], first.deps)).toBe(EXIT_STORE);
    expect(readHalted(dir)?.reason).toBe("store_unreadable");

    const unprotect = vi.spyOn(dpapi, "unprotect");
    const again = cli({ dpapi, runAgent: vi.fn() as never });
    expect(await runCli(["run"], again.deps)).toBe(EXIT_OK);
    expect(unprotect).not.toHaveBeenCalled();
    expect(again.err.join("\n")).toContain("agent resume");
  });

  it("`resume`, a new enrolment, set-tokens and forget-credential each clear it; an ordinary usage error does not write it", async () => {
    const dpapi = await enrolled();
    writeHalted(dir, "credential_rejected");
    expect(await runCli(["resume"], cli({ dpapi }).deps)).toBe(EXIT_OK);
    expect(readHalted(dir)).toBeUndefined();

    writeHalted(dir, "store_unreadable");
    await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test", "--replace"], cli({ dpapi, fetch: enrollFetch }).deps);
    expect(readHalted(dir)).toBeUndefined();

    writeHalted(dir, "credential_rejected");
    await runCli(["set-tokens"], cli({ dpapi, answers: [API_TOKEN, ""] }).deps);
    expect(readHalted(dir)).toBeUndefined();

    writeHalted(dir, "credential_rejected");
    await runCli(["forget-credential"], cli({ dpapi }).deps);
    expect(readHalted(dir)).toBeUndefined();

    const notEnrolled = mkdtempSync(path.join(os.tmpdir(), "sd-agent-hard2-"));
    const t = cli({ env: { SD_AGENT_HOME: notEnrolled } });
    expect(await runCli(["run"], t.deps)).toBe(EXIT_FAILED);
    expect(readHalted(notEnrolled)).toBeUndefined(); // "not enrolled" is fixed by enrolling, not a halt
    rmSync(notEnrolled, { recursive: true, force: true });
  });

  it("the marker holds a reason and a time only, ignores a corrupt or foreign file, and clearing a missing one is fine", () => {
    writeHalted(dir, "credential_rejected", () => Date.parse("2026-09-26T12:00:00.000Z"));
    expect(readFileSync(path.join(dir, "halted.json"), "utf8").trim()).toBe('{"reason":"credential_rejected","at":"2026-09-26T12:00:00.000Z"}');
    expect(readHalted(dir)).toEqual({ reason: "credential_rejected", at: "2026-09-26T12:00:00.000Z" });
    for (const junk of ["{ not json", '{"reason":"something_else","at":"x"}', '{"reason":"credential_rejected"}', "[]", ""]) {
      writeFileSync(path.join(dir, "halted.json"), junk);
      expect(readHalted(dir), junk).toBeUndefined();
    }
    clearHalted(dir);
    clearHalted(dir);
    expect(existsSync(path.join(dir, "halted.json"))).toBe(false);
  });
});

describe("enrolling never spends the code before DPAPI is proven to work", () => {
  it("a DPAPI that cannot protect stops enrol BEFORE the backend is called (the one-time code stays unspent)", async () => {
    const first = cli({ answers: [API_TOKEN, ""] });
    await runCli(["set-tokens"], first.deps);
    first.dpapi.failProtect = true;
    const fetchSpy = vi.fn(enrollFetch);
    const t = cli({ dpapi: first.dpapi, fetch: fetchSpy as never });
    expect(await runCli(["enroll", "AB3D-7XQ2", "--url", "https://api.example.test"], t.deps)).toBe(EXIT_STORE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a set-tokens that is cancelled leaves no store file at all (ask first, save after)", async () => {
    const t = cli({ prompt: async () => Promise.reject(new (await import("./prompt.js")).PromptAborted()) });
    expect(await runCli(["set-tokens", "--host", "192.168.1.5"], t.deps)).toBe(EXIT_FAILED);
    expect(existsSync(path.join(dir, "store.json"))).toBe(false);
  });
});

describe("the store", () => {
  it("re-checks the game host when it OPENS: a hand-edited file cannot point the game token at a public host", () => {
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 1, game: { host: "evil.example.com", apiPort: 7777, frmPort: 8080 } }));
    expect(() => AgentStore.open(dir, fakeDpapi())).toThrow(StoreError);
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 1, game: { host: "fd00:@evil.com", apiPort: 7777, frmPort: 8080 } }));
    expect(() => AgentStore.open(dir, fakeDpapi())).toThrow(/own network/);
    writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 1, game: { host: "10.0.0.5", apiPort: 7777, frmPort: 8080 } }));
    expect(AgentStore.open(dir, fakeDpapi()).game.host).toBe("10.0.0.5");
  });

  it("a failed save leaves no temporary file behind (an antivirus lock can fail the rename)", async () => {
    const store = AgentStore.open(dir, fakeDpapi());
    mkdirSync(path.join(dir, "store.json")); // a DIRECTORY where the file should go: the rename must fail
    await expect(store.setSecret("apiToken", API_TOKEN)).rejects.toThrow();
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("probe() proves DPAPI round-trips without storing anything, and fails loudly when it cannot", async () => {
    const dpapi = fakeDpapi();
    const store = AgentStore.open(dir, dpapi);
    await expect(store.probe()).resolves.toBeUndefined();
    expect(existsSync(path.join(dir, "store.json"))).toBe(false);
    dpapi.failProtect = true;
    await expect(store.probe()).rejects.toBeInstanceOf(DpapiError);
    const liar: Dpapi = { protect: async () => "abcd", unprotect: async () => "something else" };
    await expect(AgentStore.open(dir, liar).probe()).rejects.toBeInstanceOf(StoreError);
  });
});

describe("the response size cap counts what ARRIVES, not what a header claims", () => {
  const client = (response: () => Response) => new BackendClient({ baseUrl: "https://api.example.test", agentSecret: "SECRET-0123456789", fetch: async () => response() });
  const snapshot = { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z", reachable: false, paused: null } as const;

  it("a body with NO Content-Length that streams past the cap is refused and its reading STOPS (no full buffering)", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(100_000).fill(0x20));
        if (pulled > 1_000) controller.close(); // would be 100 MB if it were read to the end
      },
    });
    const error = (await client(() => new Response(stream, { status: 200 })).postSnapshot(snapshot).catch((err: unknown) => err)) as BackendError;
    expect(error).toBeInstanceOf(BackendError);
    expect([error.kind, error.message]).toEqual(["transient", "The backend's answer is too large."]);
    expect(pulled).toBeLessThan(20);
  });

  it("a header that lies (small Content-Length, big body) is caught too, and an honest small answer still parses", async () => {
    const big = new Response("x".repeat(1_100_000), { status: 200, headers: { "content-length": "10" } });
    await expect(client(() => big).postSnapshot(snapshot)).rejects.toMatchObject({ kind: "transient" });
    const ok = await client(() => new Response(JSON.stringify(agentSnapshotResponse), { status: 200 })).postSnapshot(snapshot);
    expect(ok).toEqual(agentSnapshotResponse);
  });

  it("multi-byte characters split across chunks decode correctly", async () => {
    const text = JSON.stringify({ ...agentSnapshotResponse, note: "héllo 🔐 wörld" });
    const bytes = new TextEncoder().encode(text);
    const cut = bytes.indexOf(0xf0) + 2; // in the middle of the 4-byte emoji
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    await expect(client(() => new Response(stream, { status: 200 })).postSnapshot(snapshot)).resolves.toEqual(agentSnapshotResponse);
  });

  it("an error status body is read under the same cap", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(new Uint8Array(200_000).fill(0x7b)) });
    const error = (await client(() => new Response(stream, { status: 500 })).postSnapshot(snapshot).catch((err: unknown) => err)) as BackendError;
    expect(error.kind).toBe("transient");
  });
});

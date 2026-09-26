import { gunzipSync } from "node:zlib";
import { vi } from "vitest";
import type { AgentCommand, AgentFactory, AgentPower, Cadence, SnapshotRequest } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, playersAvailable, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { runAgent } from "./agentRunner.js";
import type { RunOutcome } from "./agentRunner.js";
import { BackendClient } from "./backendClient.js";
import type { AgentLogger, LogFields } from "./logger.js";
import type { GameReader } from "./sampler.js";

/**
 * A fake backend, a fake game and a fast clock for testing the whole agent without a network (test support: not shipped, the
 * bundle starts from cli.ts). The fake backend enforces what the real one does: the Bearer, JSON or gzip bodies, and a
 * response in the contract's shape.
 */

export const HARNESS_SECRET = "AGENT-SECRET-value-0123456789abcdefghijklmnopqrstuvwxyz";

export interface FakeReply {
  status: number;
  body?: unknown;
}

export interface HarnessOptions {
  /** Answers to successive command polls; after these the poll blocks until the agent stops (a long-poll with nothing to say). */
  commands?: AgentCommand[][];
  cadence?: Cadence;
  queueMax?: number;
}

export function agentRunnerHarness(options: HarnessOptions = {}) {
  const cadence: Cadence = options.cadence ?? { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
  const events: { level: string; event: string; fields?: LogFields }[] = [];
  const logger: AgentLogger = {
    info: (event, fields) => events.push({ level: "info", event, fields }),
    warn: (event, fields) => events.push({ level: "warn", event, fields }),
    error: (event, fields) => events.push({ level: "error", event, fields }),
    addSecret: () => undefined,
  };
  const game = {
    readStatus: vi.fn(async () => ({ ...statusRunning.data })),
    readPower: vi.fn(async () => agentSnapshotRequestFull.power as AgentPower),
    readFactory: vi.fn(async () => agentSnapshotRequestFull.factory as AgentFactory),
    readPlayers: vi.fn(async () => playersAvailable),
    readAutoPause: vi.fn(async () => true),
    applyAutoPause: vi.fn(async (_enabled: boolean) => undefined),
  };

  const snapshots: SnapshotRequest[] = [];
  const results: { id: string; body: { ok: boolean; code?: string } }[] = [];
  const requests: { url: string; authorization: string | undefined; redirect: string | undefined }[] = [];
  const backend: { snapshotHandler: () => FakeReply | undefined; commandsHandler: () => FakeReply | undefined } = { snapshotHandler: () => undefined, commandsHandler: () => undefined };
  const pollScript = [...(options.commands ?? [])];

  const json = (reply: FakeReply) => new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    requests.push({ url, authorization: headers.authorization, redirect: init.redirect });
    if (headers.authorization !== `Bearer ${HARNESS_SECRET}`) return json({ status: 401, body: { error: { code: "unauthorized", message: "no", requestId: "r" } } });
    const path = new URL(url).pathname;
    if (path === "/agent/v1/snapshots") {
      const forced = backend.snapshotHandler();
      if (forced !== undefined) return json(forced);
      const raw = init.body as string | Buffer;
      const text = typeof raw === "string" ? raw : gunzipSync(raw).toString("utf8");
      snapshots.push(JSON.parse(text) as SnapshotRequest);
      return json({ status: 200, body: { cadence, commandsPending: false } });
    }
    if (path === "/agent/v1/commands") {
      const forced = backend.commandsHandler();
      if (forced !== undefined) return json(forced);
      const next = pollScript.shift();
      if (next !== undefined) return json({ status: 200, body: { commands: next } });
      // Nothing to say: hold the long-poll until the agent goes away.
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }
    const result = /^\/agent\/v1\/commands\/([^/]+)\/result$/.exec(path);
    if (result) {
      results.push({ id: decodeURIComponent(result[1]!), body: JSON.parse(init.body as string) as { ok: boolean; code?: string } });
      return json({ status: 200, body: { accepted: true } });
    }
    return json({ status: 404, body: { error: { code: "not_found", message: "no", requestId: "r" } } });
  };

  const sleeps: number[] = [];
  const sleep = async (ms: number, signal: AbortSignal) => {
    sleeps.push(ms);
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, 2); // fast clock: any wait is 2 ms
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    });
  };

  const controller = new AbortController();
  const client = new BackendClient({ baseUrl: "https://api.example.test", agentSecret: HARNESS_SECRET, fetch: fetchImpl });
  return {
    game,
    backend,
    snapshots,
    results,
    requests,
    events,
    sleeps,
    stop: () => controller.abort(),
    run: (): Promise<RunOutcome> => runAgent({ reader: game as GameReader, client, logger, signal: controller.signal, sleep, random: () => 0, queueMax: options.queueMax }),
    until: async (condition: () => boolean, timeoutMs = 4_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!condition() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@satisfactory-dash/game-adapter";
import type { AgentCommand } from "@satisfactory-dash/shared";
import { BackendError } from "./backendClient.js";
import { CommandRunner, MIN_POLL_SPACING_MS, resultCodeFor } from "./commandRunner.js";
import type { AgentLogger, LogFields } from "./logger.js";
import type { Sleep } from "./pusher.js";

const T0 = Date.parse("2026-09-26T12:00:00.000Z");
const command = (id: string, over: Partial<AgentCommand> = {}): AgentCommand => ({ id, type: "set_auto_pause", params: { enabled: true }, expiresAt: new Date(T0 + 60_000).toISOString(), ...over });
type Step = AgentCommand[] | Error | (() => Promise<AgentCommand[]>);

function setup(steps: Step[], options: { applyAutoPause?: (enabled: boolean) => Promise<void>; postResult?: (id: string, body: { ok: boolean; code?: string }) => Promise<void>; now?: () => number } = {}) {
  const events: { level: string; event: string; fields?: LogFields }[] = [];
  const logger: AgentLogger = {
    info: (event, fields) => events.push({ level: "info", event, fields }),
    warn: (event, fields) => events.push({ level: "warn", event, fields }),
    error: (event, fields) => events.push({ level: "error", event, fields }),
    addSecret: () => undefined,
  };
  const delays: number[] = [];
  const sleep: Sleep = async (ms) => {
    delays.push(ms);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  };
  const controller = new AbortController();
  const remaining = [...steps];
  const polls = vi.fn(async (_wait: number, signal?: AbortSignal) => {
    const step = remaining.shift();
    if (step === undefined) {
      // Script over: behave like a long-poll that never answers, until the runner is stopped.
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      return [];
    }
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step;
  });
  const results: { id: string; body: { ok: boolean; code?: string } }[] = [];
  const postResult = vi.fn(async (id: string, body: { ok: boolean; code?: string }) => {
    results.push({ id, body });
    await options.postResult?.(id, body);
  });
  const applyAutoPause = vi.fn(options.applyAutoPause ?? (async () => undefined));
  const onAuthRejected = vi.fn();
  const runner = new CommandRunner({
    client: { pollCommands: polls, postResult: postResult as never },
    game: { applyAutoPause },
    logger,
    now: options.now ?? (() => T0),
    sleep,
    random: () => 0,
    onAuthRejected,
  });
  return { runner, controller, events, delays, polls, results, postResult, applyAutoPause, onAuthRejected, run: () => runner.run(controller.signal) };
}
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise<void>((resolve) => setTimeout(resolve, 5));
}
const stop = async (t: ReturnType<typeof setup>, running: Promise<void>) => {
  t.controller.abort();
  await running;
};

describe("running a command", () => {
  it("applies set_auto_pause with the commanded value and reports ok (no code on a success)", async () => {
    const t = setup([[command("c1", { params: { enabled: false } })]]);
    const running = t.run();
    await until(() => t.results.length === 1);
    expect(t.applyAutoPause).toHaveBeenCalledWith(false);
    expect(t.results).toEqual([{ id: "c1", body: { ok: true } }]);
    await stop(t, running);
  });

  it("an unknown type, or params that do not parse, is `unsupported` and never touches the game", async () => {
    const t = setup([[command("a", { type: "reboot_server", params: {} }), command("b", { params: { enabled: "yes" } }), command("c", { params: { enabled: true, extra: 1 } })]]);
    const running = t.run();
    await until(() => t.results.length === 3);
    expect(t.results.map((entry) => entry.body)).toEqual([{ ok: false, code: "unsupported" }, { ok: false, code: "unsupported" }, { ok: false, code: "unsupported" }]);
    expect(t.applyAutoPause).not.toHaveBeenCalled();
    expect(JSON.stringify(t.events)).not.toContain("reboot_server"); // a backend-chosen type name is logged generically
    await stop(t, running);
  });

  it("a game failure is reported as a CODE from the fixed list, never its message", async () => {
    const cases: [Error, string][] = [
      [new UpstreamError("connect ECONNREFUSED 127.0.0.1 token=SECRET", { failureKind: "unreachable" }), "upstream_unreachable"],
      [new UpstreamError("Bearer SECRET rejected", { status: 401 }), "upstream_auth_rejected"],
      [new UpstreamError("forbidden", { status: 403 }), "upstream_auth_rejected"],
      [new UpstreamError("server said no: SECRET", { status: 500 }), "upstream_error"],
      [new TypeError("boom SECRET"), "upstream_error"],
    ];
    for (const [error, code] of cases) {
      const t = setup([[command("x")]], { applyAutoPause: async () => Promise.reject(error) });
      const running = t.run();
      await until(() => t.results.length === 1);
      expect(t.results[0]!.body, code).toEqual({ ok: false, code });
      expect(JSON.stringify([t.results, t.events])).not.toContain("SECRET");
      await stop(t, running);
    }
    expect(resultCodeFor(new UpstreamError("x", { failureKind: "unreachable" }))).toBe("upstream_unreachable");
  });
});

describe("de-duplication and expiry (idempotent, architect rule)", () => {
  it("a command delivered again is NOT run again: its SAME result is re-reported", async () => {
    const t = setup([[command("c1")], [command("c1")], [command("c1")]], { applyAutoPause: async () => undefined });
    const running = t.run();
    await until(() => t.results.length === 3);
    expect(t.applyAutoPause).toHaveBeenCalledTimes(1);
    expect(t.results.map((entry) => entry.body)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(t.events.filter((entry) => entry.event === "command_duplicate")).toHaveLength(2);
    await stop(t, running);
  });

  it("a failed command's duplicate re-reports the same failure code, without a second attempt", async () => {
    const t = setup([[command("c1")], [command("c1")]], { applyAutoPause: async () => Promise.reject(new UpstreamError("x", { failureKind: "unreachable" })) });
    const running = t.run();
    await until(() => t.results.length === 2);
    expect(t.applyAutoPause).toHaveBeenCalledTimes(1);
    expect(t.results.map((entry) => entry.body)).toEqual([{ ok: false, code: "upstream_unreachable" }, { ok: false, code: "upstream_unreachable" }]);
    await stop(t, running);
  });

  it("two DIFFERENT commands both run; the same id twice in ONE answer runs once", async () => {
    const t = setup([[command("a", { params: { enabled: true } }), command("b", { params: { enabled: false } }), command("a")]]);
    const running = t.run();
    await until(() => t.results.length === 3);
    expect(t.applyAutoPause.mock.calls).toEqual([[true], [false]]);
    await stop(t, running);
  });

  it("an expired command is never run and never reported", async () => {
    const t = setup([[command("old", { expiresAt: new Date(T0 - 1).toISOString() }), command("edge", { expiresAt: new Date(T0).toISOString() }), command("junk", { expiresAt: "not a time" })]]);
    const running = t.run();
    await until(() => t.events.filter((entry) => entry.event === "command_expired_skipped").length === 3);
    expect(t.applyAutoPause).not.toHaveBeenCalled();
    expect(t.postResult).not.toHaveBeenCalled();
    await stop(t, running);
  });

  it("forgets an id after its own expiry: a later, different command with a reused id is new", async () => {
    let now = T0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const later = async () => {
      await gate; // the second answer arrives only after the clock has moved on
      return [command("c1", { expiresAt: new Date(T0 + 200_000).toISOString() })];
    };
    const t = setup([[command("c1")], later], { now: () => now });
    const running = t.run();
    await until(() => t.results.length === 1);
    now = T0 + 61_000; // past the first command's expiry
    release?.();
    await until(() => t.results.length === 2);
    expect(t.applyAutoPause).toHaveBeenCalledTimes(2);
    await stop(t, running);
  });
});

describe("reporting the result", () => {
  it("retries a transient failure with backoff while the command is alive, then succeeds", async () => {
    let failures = 2;
    const t = setup([[command("c1")]], { postResult: async () => (failures-- > 0 ? Promise.reject(new BackendError("transient", "x", { status: 503 })) : undefined) });
    const running = t.run();
    await until(() => t.results.length === 3);
    expect(t.delays.slice(0, 2)).toEqual([500, 1000]);
    await stop(t, running);
  });

  it("does not retry a refusal: command_expired or command_not_found means the backend has closed it", async () => {
    const t = setup([[command("c1")]], { postResult: async () => Promise.reject(new BackendError("fatal", "x", { status: 409, code: "command_expired" })) });
    const running = t.run();
    await until(() => t.results.length >= 1 && t.delays.length >= 1);
    expect(t.results).toHaveLength(1);
    await stop(t, running);
  });

  it("stops trying once the command has expired (the backend would refuse it)", async () => {
    let now = T0;
    const t = setup([[command("c1")]], {
      now: () => now,
      postResult: async () => {
        now = T0 + 61_000;
        throw new BackendError("transient", "x", { status: 503 });
      },
    });
    const running = t.run();
    await until(() => t.results.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.results).toHaveLength(1);
    await stop(t, running);
  });

  it("a 401 while reporting stops the runner and tells the caller", async () => {
    const t = setup([[command("c1")]], { postResult: async () => Promise.reject(new BackendError("auth_rejected", "x", { status: 401 })) });
    await t.run();
    expect(t.onAuthRejected).toHaveBeenCalledTimes(1);
    expect(t.polls).toHaveBeenCalledTimes(1);
  });
});

describe("the long-poll loop", () => {
  it("a failed poll backs off with jitter and retries, logging once and saying when it recovered", async () => {
    const t = setup([new BackendError("transient", "x", { status: 503 }), new BackendError("transient", "x", { status: 503 }), []]);
    const running = t.run();
    await until(() => t.polls.mock.calls.length >= 4);
    expect(t.delays.slice(0, 2)).toEqual([500, 1000]);
    expect(t.events.filter((entry) => entry.event === "poll_failed")).toEqual([{ level: "warn", event: "poll_failed", fields: { code: "unreachable_or_5xx", status: 503 } }]);
    expect(t.events).toContainEqual({ level: "info", event: "poll_recovered", fields: { attempts: 2 } });
    await stop(t, running);
  });

  it("a 401 on the poll stops the runner: no retry", async () => {
    const t = setup([new BackendError("auth_rejected", "x", { status: 401 })]);
    await t.run();
    expect(t.onAuthRejected).toHaveBeenCalledTimes(1);
    expect(t.polls).toHaveBeenCalledTimes(1);
    expect(t.delays).toEqual([]);
  });

  it("an answer that comes back at once is spaced (a floor between polls), never a tight loop", async () => {
    const t = setup([[], []]);
    const running = t.run();
    await until(() => t.polls.mock.calls.length >= 3);
    expect(t.delays.slice(0, 2)).toEqual([MIN_POLL_SPACING_MS, MIN_POLL_SPACING_MS]);
    await stop(t, running);
  });

  it("a pending hint from the snapshot answer ends the spacing wait early", async () => {
    let releaseSleep: (() => void) | undefined;
    const events: string[] = [];
    const controller = new AbortController();
    let polls = 0;
    const runner = new CommandRunner({
      client: {
        pollCommands: async (_wait, signal) => {
          polls += 1;
          if (polls > 1) await new Promise<void>((_r, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
          return [];
        },
        postResult: async () => undefined,
      },
      game: { applyAutoPause: async () => undefined },
      logger: { info: (e) => events.push(e), warn() {}, error() {}, addSecret() {} },
      now: () => T0,
      sleep: () => new Promise<void>((resolve) => (releaseSleep = resolve)), // would wait "forever"
      onAuthRejected() {},
    });
    const running = runner.run(controller.signal);
    await until(() => releaseSleep !== undefined);
    expect(polls).toBe(1);
    runner.notifyPending();
    await until(() => polls === 2);
    expect(polls).toBe(2);
    controller.abort();
    releaseSleep?.();
    await running;
  });

  it("an abort ends the loop", async () => {
    const t = setup([]);
    const running = t.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await stop(t, running);
    expect(t.polls).toHaveBeenCalledTimes(1);
  });
});

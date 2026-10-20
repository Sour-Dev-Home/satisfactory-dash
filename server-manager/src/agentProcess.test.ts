import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_COMMANDS,
  AGENT_NOT_BUILT,
  agentScriptPath,
  createRun,
  fakeAgentToolsPath,
  runAgentCommand,
} from "./agentProcess";
import type { RunFn } from "./agentTask";
import { RUN_WITH_NODE_ENV, type NodeSpawn } from "./serverProcess";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
  /** Ends the process: its output closes, then `close` with the exit code. */
  finish(code: number | null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code));
  }
}

const MAIN_DIR = resolve("/checkout/server-manager/dist");

function capture(onSpawn?: (child: FakeChild) => void) {
  const calls: { file: string; args: readonly string[]; opts: Parameters<NodeSpawn>[2] }[] = [];
  const children: FakeChild[] = [];
  const spawn: NodeSpawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    const child = new FakeChild();
    children.push(child);
    if (onSpawn) onSpawn(child);
    else setImmediate(() => child.finish(0));
    return child as unknown as ReturnType<NodeSpawn>;
  };
  return { calls, children, spawn };
}

const exists = () => true;

afterEach(() => {
  vi.useRealTimers();
});

describe("agentScriptPath", () => {
  it("is the built agent beside the server manager in the same checkout", () => {
    expect(agentScriptPath(MAIN_DIR)).toBe(resolve("/checkout/agent/dist/agent.cjs"));
    expect(fakeAgentToolsPath(MAIN_DIR)).toBe(resolve("/checkout/server-manager/e2e/fake-agent.cjs"));
  });
});

describe("createRun", () => {
  it("runs PowerShell from System32 with the given args and no shell", async () => {
    const { calls, spawn } = capture();
    const run = createRun({ env: { SystemRoot: "C:\\Windows" }, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await run("powershell", ["-NoProfile", "-Command", "x"]);
    expect(calls[0]!.file).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(calls[0]!.args).toEqual(["-NoProfile", "-Command", "x"]);
    expect(calls[0]!.opts.shell).toBe(false);
    expect(calls[0]!.opts.windowsHide).toBe(true);
    expect(calls[0]!.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(calls[0]!.opts.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("runs the agent's commands as `node <checkout>/agent/dist/agent.cjs <command>` with Electron's Node", async () => {
    const { calls, spawn } = capture();
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await run("agent", ["status"]);
    expect(calls[0]!.file).toBe("E");
    expect(calls[0]!.args).toEqual([agentScriptPath(MAIN_DIR), "status"]);
    expect(calls[0]!.opts.shell).toBe(false);
    expect(calls[0]!.opts.env?.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("refuses to run the agent when it isn't built", async () => {
    const { calls, spawn } = capture();
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists: () => false });
    await expect(run("agent", ["status"])).rejects.toThrow(AGENT_NOT_BUILT);
    expect(calls).toHaveLength(0);
  });

  it("with the e2e switch runs the fixed fake script instead of PowerShell or the agent", async () => {
    const { calls, spawn } = capture();
    const run = createRun({ env: { [RUN_WITH_NODE_ENV]: "1", SystemRoot: "C:\\Windows" }, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await run("powershell", ["-Command", "Get-ScheduledTask"]);
    await run("agent", ["check"]);
    expect(calls.map((c) => c.file)).toEqual(["E", "E"]);
    expect(calls[0]!.args).toEqual([fakeAgentToolsPath(MAIN_DIR), "powershell", "-Command", "Get-ScheduledTask"]);
    expect(calls[1]!.args).toEqual([fakeAgentToolsPath(MAIN_DIR), "agent", "check"]);
    expect(calls[0]!.opts.env?.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("ignores any other value of the switch", async () => {
    for (const value of ["true", "yes", "0", ""]) {
      const { calls, spawn } = capture();
      const run = createRun({ env: { [RUN_WITH_NODE_ENV]: value, SystemRoot: "C:\\W" }, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
      await run("powershell", ["-Command", "x"]);
      expect(calls[0]!.file).toBe("C:\\W\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    }
  });

  it("runs nothing it wasn't built for", async () => {
    const { calls, spawn } = capture();
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await expect(run("cmd" as never, ["/c", "x"])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("collects stdout, stderr and the exit code", async () => {
    const { spawn } = capture((child) => {
      setImmediate(() => {
        child.stdout.write("out 1\n");
        child.stderr.write("err\n");
        child.stdout.write("out 2\n");
        child.finish(3);
      });
    });
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await expect(run("agent", ["check"])).resolves.toEqual({ code: 3, stdout: "out 1\nout 2\n", stderr: "err\n" });
  });

  it("keeps only the end of a huge output", async () => {
    const { spawn } = capture((child) => {
      setImmediate(() => {
        child.stdout.write("a".repeat(100_000));
        child.stdout.write("END");
        child.finish(0);
      });
    });
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    const result = await run("agent", ["status"]);
    expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.stdout.endsWith("END")).toBe(true);
  });

  it("ends a process that runs too long and reports no exit code", async () => {
    let started: FakeChild | undefined;
    const { spawn } = capture((child) => {
      started = child;
    });
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists, timeoutMs: 20 });
    const pending = run("agent", ["check"]);
    await new Promise((r) => setTimeout(r, 40));
    expect(started?.killed).toBe(true);
    started?.finish(null);
    await expect(pending).resolves.toMatchObject({ code: null });
  });

  it("rejects when the process can't start", async () => {
    const { spawn } = capture((child) => {
      setImmediate(() => child.emit("error", new Error("spawn ENOENT")));
    });
    const run = createRun({ env: {}, execPath: "E", mainDir: MAIN_DIR, spawn, exists });
    await expect(run("powershell", [])).rejects.toThrow("ENOENT");
  });
});

describe("runAgentCommand", () => {
  const fake = (result: { code: number | null; stdout: string; stderr: string } | Error) => {
    const calls: { program: string; args: readonly string[] }[] = [];
    const run: RunFn = async (program, args) => {
      calls.push({ program, args });
      if (result instanceof Error) throw result;
      return result;
    };
    return { run, calls };
  };

  it("offers check, status and resume only: never set-tokens or enroll, which prompt for secrets", () => {
    expect([...AGENT_COMMANDS].sort()).toEqual(["check", "resume", "status"]);
  });

  it.each(["check", "status", "resume"] as const)("runs `agent %s` and returns its output", async (command) => {
    const { run, calls } = fake({ code: 0, stdout: "all good\n", stderr: "" });
    await expect(runAgentCommand(run, command)).resolves.toEqual({ command, exitCode: 0, output: "all good" });
    expect(calls).toEqual([{ program: "agent", args: [command] }]);
  });

  it("shows stderr after stdout, with the exit code", async () => {
    const { run } = fake({ code: 1, stdout: "checking\n", stderr: "game unreachable\n" });
    await expect(runAgentCommand(run, "check")).resolves.toEqual({ command: "check", exitCode: 1, output: "checking\ngame unreachable" });
  });

  it("reports a command that couldn't run", async () => {
    const { run } = fake(new Error(AGENT_NOT_BUILT));
    await expect(runAgentCommand(run, "status")).resolves.toEqual({ command: "status", exitCode: null, output: AGENT_NOT_BUILT });
  });

  it("refuses any other command from the window", async () => {
    for (const command of ["set-tokens", "enroll", "run", "forget-credential", "check --x", "", undefined, 1, { command: "check" }]) {
      const { run, calls } = fake({ code: 0, stdout: "", stderr: "" });
      await expect(runAgentCommand(run, command)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  });
});

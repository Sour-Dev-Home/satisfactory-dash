import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { RUN_WITH_NODE_ENV, serverSpawn, type NodeSpawn } from "./serverProcess";

class FakeNodeChild extends EventEmitter {
  pid = 9;
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function capture() {
  const calls: { file: string; args: readonly string[]; opts: Parameters<NodeSpawn>[2] }[] = [];
  const child = new FakeNodeChild();
  const spawn: NodeSpawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    return child as unknown as ReturnType<NodeSpawn>;
  };
  return { calls, child, spawn };
}

describe("serverSpawn", () => {
  it("runs the exe itself with the given args, from its folder, with no shell", () => {
    const { calls, spawn } = capture();
    serverSpawn({ env: {}, execPath: "E", spawn })("X:\\srv\\FactoryServer.exe", ["-log"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("X:\\srv\\FactoryServer.exe");
    expect(calls[0]!.args).toEqual(["-log"]);
    expect(calls[0]!.opts.shell).toBe(false);
    expect(calls[0]!.opts.windowsHide).toBe(true);
    expect(calls[0]!.opts.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("with the test switch runs the same file as a Node script through Electron", () => {
    const { calls, spawn } = capture();
    serverSpawn({ env: { [RUN_WITH_NODE_ENV]: "1" }, execPath: "E", spawn })("/s/FactoryServer.exe", ["-log"]);
    expect(calls[0]!.file).toBe("E");
    expect(calls[0]!.args).toEqual(["/s/FactoryServer.exe", "-log"]);
    expect(calls[0]!.opts.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(calls[0]!.opts.shell).toBe(false);
  });

  it("ignores any other value of the test switch", () => {
    const { calls, spawn } = capture();
    serverSpawn({ env: { [RUN_WITH_NODE_ENV]: "true" }, execPath: "E", spawn })("/s/FactoryServer.exe", ["-log"]);
    expect(calls[0]!.file).toBe("/s/FactoryServer.exe");
  });

  it("adapts the child: pid, kill and the spawn, exit and error events", () => {
    const { child, spawn } = capture();
    const handle = serverSpawn({ env: {}, execPath: "E", spawn })("/s/FactoryServer.exe", ["-log"]);
    const seen: string[] = [];
    handle.onSpawn(() => seen.push("spawn"));
    handle.onExit((code, signal) => seen.push(`exit ${code} ${signal}`));
    handle.onError((err) => seen.push(`error ${err.message}`));
    child.emit("spawn");
    child.emit("exit", 2, null);
    child.emit("error", new Error("x"));
    expect(seen).toEqual(["spawn", "exit 2 null", "error x"]);
    expect(handle.pid).toBe(9);
    handle.kill();
    expect(child.killed).toBe(true);
  });

  it("the server's spawn pipes nothing", () => {
    const { calls, spawn } = capture();
    serverSpawn({ env: {}, execPath: "E", spawn })("/s/FactoryServer.exe", ["-log"]);
    expect(calls[0]!.opts.stdio).toBe("ignore");
  });

  it("with output on, pipes stdout and stderr, still with no shell, and reports exit on close", () => {
    const { calls, child, spawn } = capture();
    const stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
    const stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
    Object.assign(child, { stdout, stderr });
    const handle = serverSpawn({ env: {}, execPath: "E", spawn, output: true })("D:\\steamcmd\\steamcmd.exe", ["+quit"]);
    expect(calls[0]!.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(calls[0]!.opts.shell).toBe(false);
    expect(calls[0]!.opts.cwd).toBe(calls[0]!.file.replace(/[\\/]steamcmd\.exe$/, ""));
    const seen: string[] = [];
    handle.onOutput?.((chunk) => seen.push(chunk));
    handle.onExit((code) => seen.push(`exit ${code}`));
    stdout.emit("data", "a\n");
    stderr.emit("data", "b\n");
    child.emit("exit", 0, null); // output may still be in flight: not reported yet
    child.emit("close", 0, null);
    expect(seen).toEqual(["a\n", "b\n", "exit 0"]);
  });
});

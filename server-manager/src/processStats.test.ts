import { describe, expect, it } from "vitest";
import { cpuPercent, parsePowerShell, parsePs, sampleProcess, type ExecFn } from "./processStats";

describe("parsePs", () => {
  it("reads mm:ss, hh:mm:ss and dd-hh:mm:ss CPU time and rss in KiB", () => {
    expect(parsePs("  01:02   2048\n")).toEqual({ cpuSeconds: 62, memoryBytes: 2048 * 1024 });
    expect(parsePs("01:00:05 10")).toEqual({ cpuSeconds: 3605, memoryBytes: 10240 });
    expect(parsePs("2-00:00:01 1")).toEqual({ cpuSeconds: 2 * 86400 + 1, memoryBytes: 1024 });
  });

  it("reads fractional seconds", () => {
    expect(parsePs("00:01.50 1")?.cpuSeconds).toBeCloseTo(1.5);
  });

  it("is undefined for empty or malformed output", () => {
    expect(parsePs("")).toBeUndefined();
    expect(parsePs("abc def")).toBeUndefined();
    expect(parsePs("01:02")).toBeUndefined();
    expect(parsePs("01:02 -5")).toBeUndefined();
  });
});

describe("parsePowerShell", () => {
  it("reads CPU seconds and working set bytes", () => {
    expect(parsePowerShell("12.5 123456789\r\n")).toEqual({ cpuSeconds: 12.5, memoryBytes: 123456789 });
  });

  it("is undefined for empty or malformed output", () => {
    expect(parsePowerShell("")).toBeUndefined();
    expect(parsePowerShell(" 5")).toBeUndefined();
    expect(parsePowerShell("x 5")).toBeUndefined();
    expect(parsePowerShell("1,5 5")).toBeUndefined();
  });
});

describe("cpuPercent", () => {
  it("is CPU time used over wall time across all cores", () => {
    expect(cpuPercent({ cpuSeconds: 10, at: 0 }, { cpuSeconds: 12, at: 2000 }, 4)).toBeCloseTo(25);
  });

  it("is undefined with no time passed, CPU time going back or no cores", () => {
    expect(cpuPercent({ cpuSeconds: 1, at: 5 }, { cpuSeconds: 2, at: 5 }, 4)).toBeUndefined();
    expect(cpuPercent({ cpuSeconds: 3, at: 0 }, { cpuSeconds: 2, at: 1000 }, 4)).toBeUndefined();
    expect(cpuPercent({ cpuSeconds: 1, at: 0 }, { cpuSeconds: 2, at: 1000 }, 0)).toBeUndefined();
  });

  it("is clamped to 100", () => {
    expect(cpuPercent({ cpuSeconds: 0, at: 0 }, { cpuSeconds: 10, at: 1000 }, 1)).toBe(100);
  });
});

describe("sampleProcess", () => {
  it("on Windows runs PowerShell with a fixed script and the pid in the environment only", async () => {
    const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
    const exec: ExecFn = async (file, args, env) => {
      calls.push({ file, args, env });
      return "3 4096";
    };
    const s = await sampleProcess(4321, { platform: "win32", exec, env: { SystemRoot: "W:\\Win" } });
    expect(s).toEqual({ cpuSeconds: 3, memoryBytes: 4096 });
    expect(calls[0]!.file).toBe("W:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(calls[0]!.args.join(" ")).not.toContain("4321");
    expect(calls[0]!.env?.SM_STATS_PID).toBe("4321");
  });

  it("elsewhere runs ps with the pid as its own argument", async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const exec: ExecFn = async (file, args) => {
      calls.push({ file, args });
      return "00:03 8";
    };
    const s = await sampleProcess(77, { platform: "linux", exec, env: {} });
    expect(s).toEqual({ cpuSeconds: 3, memoryBytes: 8192 });
    expect(calls[0]).toEqual({ file: "ps", args: ["-o", "time=,rss=", "-p", "77"] });
  });

  it("refuses a pid that is not a positive integer without running anything", async () => {
    let ran = false;
    const exec: ExecFn = async () => {
      ran = true;
      return "";
    };
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(await sampleProcess(pid, { platform: "linux", exec, env: {} })).toBeUndefined();
    }
    expect(ran).toBe(false);
  });

  it("is undefined when the tool fails (the process is gone)", async () => {
    const exec: ExecFn = async () => {
      throw new Error("no such process");
    };
    expect(await sampleProcess(5, { platform: "linux", exec, env: {} })).toBeUndefined();
  });
});

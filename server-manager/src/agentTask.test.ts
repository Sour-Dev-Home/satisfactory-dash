import { describe, expect, it } from "vitest";
import { AGENT_TASK_NAME, readAgentTask, startAgentTask, stopAgentTask, type RunFn, type RunResult } from "./agentTask";

/** A fake RunFn: records each call and answers with `result` (no PowerShell, no Task Scheduler). */
function fakeRun(result: Partial<RunResult> | Error) {
  const calls: { program: string; args: readonly string[] }[] = [];
  const run: RunFn = async (program, args) => {
    calls.push({ program, args });
    if (result instanceof Error) throw result;
    return { code: 0, stdout: "", stderr: "", ...result };
  };
  return { run, calls };
}

const script = (args: readonly string[]) => args[args.indexOf("-Command") + 1] ?? "";

describe("readAgentTask", () => {
  it.each([
    ["Running", "running"],
    ["Queued", "running"],
    ["Ready", "ready"],
    ["Disabled", "disabled"],
    ["Missing", "missing"],
    ["Ready\r\n", "ready"],
  ] as const)("maps PowerShell's %j to %s", async (stdout, state) => {
    const { run } = fakeRun({ stdout });
    await expect(readAgentTask(run)).resolves.toBe(state);
  });

  it("asks PowerShell with a fixed script that names only the constant task", async () => {
    const { run, calls } = fakeRun({ stdout: "Ready" });
    await readAgentTask(run);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.program).toBe("powershell");
    expect(calls[0]!.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(calls[0]!.args).toHaveLength(4);
    expect(script(calls[0]!.args)).toContain(`Get-ScheduledTask -TaskName '${AGENT_TASK_NAME}'`);
    expect(AGENT_TASK_NAME).toBe("Satisfactory Dash Agent");
  });

  it("tells a missing task (ObjectNotFound) apart from other failures", async () => {
    const { run, calls } = fakeRun({ stdout: "Missing" });
    await readAgentTask(run);
    expect(script(calls[0]!.args)).toContain("ObjectNotFound");
  });

  it("rejects output it doesn't know rather than guess a state", async () => {
    for (const stdout of ["Unknown", "", "running", "Ready Running"]) {
      await expect(readAgentTask(fakeRun({ stdout }).run)).rejects.toThrow();
    }
  });

  it("rejects when PowerShell fails or can't run", async () => {
    await expect(readAgentTask(fakeRun({ code: 1, stdout: "Ready" }).run)).rejects.toThrow();
    await expect(readAgentTask(fakeRun({ code: null, stdout: "Ready" }).run)).rejects.toThrow();
    await expect(readAgentTask(fakeRun(new Error("ENOENT")).run)).rejects.toThrow();
  });
});

describe("startAgentTask and stopAgentTask", () => {
  it.each([
    ["start", startAgentTask, "Start-ScheduledTask"],
    ["stop", stopAgentTask, "Stop-ScheduledTask"],
  ] as const)("%s runs %s for the constant task only", async (_name, fn, cmdlet) => {
    const { run, calls } = fakeRun({});
    await fn(run);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.program).toBe("powershell");
    expect(calls[0]!.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    const text = script(calls[0]!.args);
    expect(text).toContain(`${cmdlet} -TaskName '${AGENT_TASK_NAME}'`);
    expect(text).not.toMatch(/Unregister|Disable|Register|Enable/);
  });

  it("rejects when the cmdlet fails", async () => {
    await expect(startAgentTask(fakeRun({ code: 1 }).run)).rejects.toThrow();
    await expect(stopAgentTask(fakeRun({ code: 1 }).run)).rejects.toThrow();
  });
});

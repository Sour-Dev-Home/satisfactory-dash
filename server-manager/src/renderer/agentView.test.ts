import { describe, expect, it } from "vitest";
import type { AgentStatus } from "../ipc";
import { agentActions, agentNote, agentStateLabel, commandHeading, haltedText, logDelta, logLineParts } from "./agentView";

const status = (over: Partial<AgentStatus> = {}): AgentStatus => ({ task: "ready", log: [], halted: undefined, busy: false, ...over });

describe("agentActions", () => {
  it.each([
    ["running", { start: false, stop: true, setup: false }],
    ["ready", { start: true, stop: false, setup: false }],
    ["disabled", { start: false, stop: false, setup: false }],
    ["missing", { start: false, stop: false, setup: true }],
    [undefined, { start: false, stop: false, setup: false }],
  ] as const)("%s", (task, expected) => {
    expect(agentActions(status({ task }))).toEqual(expected);
  });

  it("waits while a Start, Stop or command runs", () => {
    expect(agentActions(status({ task: "ready", busy: true }))).toEqual({ start: false, stop: false, setup: false });
    expect(agentActions(status({ task: "running", busy: true }))).toEqual({ start: false, stop: false, setup: false });
  });
});

describe("agentStateLabel and agentNote", () => {
  it("names each state", () => {
    expect(agentStateLabel("running")).toBe("running");
    expect(agentStateLabel("ready")).toBe("ready");
    expect(agentStateLabel("disabled")).toBe("disabled");
    expect(agentStateLabel("missing")).toBe("not set up");
    expect(agentStateLabel(undefined)).toBe("unknown");
  });

  it("explains the states that need the owner", () => {
    expect(agentNote(status({ task: "missing" }))).toMatch(/Scheduled Task/);
    expect(agentNote(status({ task: "disabled" }))).toMatch(/Task Scheduler/);
    expect(agentNote(status({ task: undefined }))).toMatch(/couldn't read/i);
    expect(agentNote(status({ task: "ready" }))).toBe("");
    expect(agentNote(status({ task: "running" }))).toBe("");
  });
});

describe("haltedText", () => {
  it("gives the reason and the runbook's fix for a rejected credential (enrol again in a console)", () => {
    const text = haltedText({ reason: "credential_rejected", at: "2026-10-20T10:00:00.000Z" });
    expect(text.reason).toContain("rejected");
    expect(text.reason).toContain("2026-10-20T10:00:00.000Z");
    expect(text.fix).toContain("enroll");
    expect(text.fix).toContain("--replace");
    expect(text.fix).toMatch(/console/);
  });

  it("gives the reason and the runbook's fix for a store it couldn't unprotect", () => {
    const text = haltedText({ reason: "store_unreadable", at: "2026-10-20T10:00:00.000Z" });
    expect(text.reason).toMatch(/unprotect/);
    expect(text.fix).toMatch(/Windows user/);
    expect(text.fix).toMatch(/Resume/);
  });
});

describe("logLineParts", () => {
  it("shows the agent's own time, event and fields, nothing derived", () => {
    const line = JSON.stringify({ t: "2026-10-20T10:00:00.000Z", level: "warn", event: "push_failed", code: "upstream_unreachable", attempt: 3 });
    expect(logLineParts(line)).toEqual({
      time: "2026-10-20T10:00:00.000Z",
      level: "warn",
      event: "push_failed",
      detail: "code=upstream_unreachable attempt=3",
    });
  });

  it("shows a line it can't read as it is", () => {
    expect(logLineParts("not json")).toEqual({ time: "", level: "", event: "", detail: "not json" });
    expect(logLineParts("[1,2]")).toEqual({ time: "", level: "", event: "", detail: "[1,2]" });
    expect(logLineParts("null")).toEqual({ time: "", level: "", event: "", detail: "null" });
  });

  it("writes values as the agent wrote them, nulls and booleans included", () => {
    const line = JSON.stringify({ t: "x", level: "info", event: "e", ok: true, gone: null });
    expect(logLineParts(line).detail).toBe("ok=true gone=null");
  });
});

describe("logDelta", () => {
  it("appends only the new lines as the window slides", () => {
    expect(logDelta(["a", "b", "c"], ["b", "c", "d", "e"])).toEqual({ drop: 1, add: ["d", "e"] });
    expect(logDelta(["a", "b"], ["a", "b", "c"])).toEqual({ drop: 0, add: ["c"] });
    expect(logDelta(["a", "b"], ["a", "b"])).toEqual({ drop: 0, add: [] });
  });

  it("replaces everything when the lines don't continue (a new day's file)", () => {
    expect(logDelta(["a", "b"], ["x", "y"])).toEqual({ drop: 2, add: ["x", "y"] });
    expect(logDelta([], ["x"])).toEqual({ drop: 0, add: ["x"] });
    expect(logDelta(["a"], [])).toEqual({ drop: 1, add: [] });
  });
});

describe("commandHeading", () => {
  it("says which command ran and how it ended", () => {
    expect(commandHeading({ command: "status", exitCode: 0, output: "" })).toBe("agent status: finished");
    expect(commandHeading({ command: "check", exitCode: 1, output: "" })).toBe("agent check: exited with code 1");
    expect(commandHeading({ command: "resume", exitCode: null, output: "" })).toBe("agent resume: didn't finish");
  });
});

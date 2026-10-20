import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_LOG_LINES, tailAgentLog } from "./agentLog";

let dataDir: string;
let logs: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sm-agentlog-"));
  logs = join(dataDir, "logs");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const line = (n: number, event = "push_ok") => JSON.stringify({ t: `2026-10-20T10:00:${String(n % 60).padStart(2, "0")}.000Z`, level: "info", event, n });

function writeLog(day: string, lines: string[], tail = ""): void {
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, `agent-${day}.log`), lines.map((l) => `${l}\n`).join("") + tail);
}

describe("tailAgentLog", () => {
  it("is empty when the agent has no log folder or no log yet", async () => {
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([]);
    mkdirSync(logs);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([]);
  });

  it("returns the newest lines of the current file, oldest first, exactly as written", async () => {
    const all = Array.from({ length: 30 }, (_, i) => line(i));
    writeLog("2026-10-20", all);
    const tail = await tailAgentLog(dataDir, AGENT_LOG_LINES);
    expect(AGENT_LOG_LINES).toBe(20);
    expect(tail).toEqual(all.slice(-20));
  });

  it("returns fewer when the file is short", async () => {
    writeLog("2026-10-20", [line(1), line(2)]);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(1), line(2)]);
  });

  it("switches to a new day's file once it exists", async () => {
    writeLog("2026-10-19", [line(1, "old_day")]);
    writeLog("2026-10-20", [line(2, "agent_started")]);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(2, "agent_started")]);
    writeLog("2026-10-21", [line(3, "new_day")]);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(3, "new_day")]);
  });

  it("picks the newest day by name, not by modification time, and ignores other files", async () => {
    writeLog("2026-10-21", [line(1, "newest")]);
    writeLog("2026-10-20", [line(2, "older")]);
    writeFileSync(join(logs, "agent-2099-01-01.log.bak"), `${line(3, "backup")}\n`);
    writeFileSync(join(logs, "notes.txt"), "x\n");
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(1, "newest")]);
  });

  it("leaves out a line the agent is still writing, and shows it once it ends", async () => {
    const partial = line(2).slice(0, 15);
    writeLog("2026-10-20", [line(1)], partial);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(1)]);
    appendFileSync(join(logs, "agent-2026-10-20.log"), `${line(2).slice(15)}\n`);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(1), line(2)]);
  });

  it("shows nothing from a file whose first line is still being written", async () => {
    writeLog("2026-10-20", [], line(1).slice(0, 10));
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([]);
  });

  it("follows the file as it grows", async () => {
    writeLog("2026-10-20", [line(1)]);
    await expect(tailAgentLog(dataDir, 2)).resolves.toEqual([line(1)]);
    appendFileSync(join(logs, "agent-2026-10-20.log"), `${line(2)}\n${line(3)}\n`);
    await expect(tailAgentLog(dataDir, 2)).resolves.toEqual([line(2), line(3)]);
  });

  it("reads only the end of a big file and never returns a cut first line", async () => {
    const all = Array.from({ length: 5000 }, (_, i) => line(i));
    writeLog("2026-10-20", all);
    const tail = await tailAgentLog(dataDir, 20);
    expect(tail).toEqual(all.slice(-20));
    const many = await tailAgentLog(dataDir, 100_000);
    expect(many.length).toBeLessThan(all.length);
    expect(many[0]).toBe(all[all.length - many.length]);
  });

  it("drops Windows line endings and blank lines", async () => {
    mkdirSync(logs);
    writeFileSync(join(logs, "agent-2026-10-20.log"), `${line(1)}\r\n\n${line(2)}\r\n`);
    await expect(tailAgentLog(dataDir, 20)).resolves.toEqual([line(1), line(2)]);
  });

  it("returns nothing for zero or a nonsense count", async () => {
    writeLog("2026-10-20", [line(1)]);
    await expect(tailAgentLog(dataDir, 0)).resolves.toEqual([]);
    await expect(tailAgentLog(dataDir, Number.NaN)).resolves.toEqual([]);
  });
});

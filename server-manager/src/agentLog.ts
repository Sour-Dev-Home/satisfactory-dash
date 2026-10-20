/**
 * The newest lines of the agent's current log, for the window. The agent writes one JSON line per event to
 * `logs\agent-YYYY-MM-DD.log` in its data folder, a file per UTC day (agent/src/logger.ts); those lines hold only codes
 * and counts, never a secret (runbooks/agent-app.md). They are returned exactly as written: a line the agent is still
 * writing (no newline yet) is left out until it ends. Only the end of the file is read.
 */
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

export const AGENT_LOG_LINES = 20;

const FILE_PATTERN = /^agent-\d{4}-\d{2}-\d{2}\.log$/;
/** Far more than 20 of the agent's lines; a bigger request gets what fits. */
const TAIL_BYTES = 64 * 1024;

/** The current day's file: the newest by name (the date in it), so a clock change or a touched old file can't win. */
async function currentLog(logsDir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(logsDir);
  } catch {
    return undefined;
  }
  const newest = names.filter((name) => FILE_PATTERN.test(name)).sort().at(-1);
  return newest === undefined ? undefined : join(logsDir, newest);
}

async function readEnd(file: string): Promise<{ text: string; cut: boolean }> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), cut: start > 0 };
  } finally {
    await handle.close();
  }
}

export async function tailAgentLog(dataDir: string, lines: number): Promise<string[]> {
  if (!Number.isInteger(lines) || lines <= 0) return [];
  const file = await currentLog(join(dataDir, "logs"));
  if (file === undefined) return [];
  let read: { text: string; cut: boolean };
  try {
    read = await readEnd(file);
  } catch {
    return [];
  }
  let text = read.text;
  // Reading from the middle of the file starts inside a line: drop that piece.
  if (read.cut) text = text.slice(text.indexOf("\n") + 1);
  // Everything after the last newline is a line still being written.
  text = text.slice(0, text.lastIndexOf("\n") + 1);
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "")
    .slice(-lines);
}

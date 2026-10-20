import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPid, leftoverPid, PID_FILE, recordPid } from "./leftoverServer";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-pid-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

describe("leftoverServer", () => {
  it("is undefined with no pid file", () => {
    expect(leftoverPid(dir, alive([1]))).toBeUndefined();
  });

  it("records the pid and finds it while that process is alive", () => {
    recordPid(dir, 4242);
    expect(readFileSync(join(dir, PID_FILE), "utf8").trim()).toBe("4242");
    expect(leftoverPid(dir, alive([4242]))).toBe(4242);
  });

  it("drops a stale pid file whose process is gone", () => {
    recordPid(dir, 4242);
    expect(leftoverPid(dir, alive([]))).toBeUndefined();
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
  });

  it("drops a malformed pid file", () => {
    for (const text of ["", "abc", "-3", "1.5", "0"]) {
      writeFileSync(join(dir, PID_FILE), text);
      expect(leftoverPid(dir, alive([0, 1, -3]))).toBeUndefined();
      expect(existsSync(join(dir, PID_FILE))).toBe(false);
    }
  });

  it("clearPid removes the file and tolerates it missing", () => {
    recordPid(dir, 7);
    clearPid(dir);
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
    expect(() => clearPid(dir)).not.toThrow();
  });

  it("recordPid ignores an undefined pid and creates the folder", () => {
    const nested = join(dir, "a");
    recordPid(nested, undefined);
    expect(existsSync(join(nested, PID_FILE))).toBe(false);
    recordPid(nested, 9);
    expect(leftoverPid(nested, alive([9]))).toBe(9);
  });
});

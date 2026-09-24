import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "./errors.js";
import { createLogger } from "./logger.js";
import { DailyLogStream, LOG_RETENTION_DAYS, purgeOldLogFiles, resolveLogDir } from "./logFiles.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "logfiles-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const names = () => readdirSync(dir).sort();
const touch = (name: string, content = "x\n") => writeFileSync(path.join(dir, name), content);
/** A day's file name, N days before `base` (UTC). */
const dayFile = (base: Date, daysAgo: number) =>
  `backend-${new Date(base.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)}.log`;

describe("resolveLogDir (LOG_DIR)", () => {
  it("is undefined when unset or blank, so logs stay on stdout", () => {
    expect(resolveLogDir({})).toBeUndefined();
    expect(resolveLogDir({ LOG_DIR: "   " })).toBeUndefined();
  });

  it("creates a missing directory (including parents) and returns its absolute path", () => {
    const target = path.join(dir, "a", "b", "logs");
    expect(resolveLogDir({ LOG_DIR: target })).toBe(path.resolve(target));
    expect(readdirSync(target)).toEqual([]);
  });

  it("refuses a path that is a file, without echoing the path", () => {
    const file = path.join(dir, "not-a-dir");
    writeFileSync(file, "x");
    let message = "";
    try {
      resolveLogDir({ LOG_DIR: file });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/^LOG_DIR must be a directory/);
    expect(message).not.toContain(file);
  });
});

describe("DailyLogStream", () => {
  it("writes lines to backend-<UTC date>.log and appends across a restart on the same day", () => {
    const now = () => at("2026-09-24T10:00:00Z");
    const first = new DailyLogStream({ dir, now });
    first.write('{"n":1}\n');
    first.write('{"n":2}\n');
    first.close();
    const second = new DailyLogStream({ dir, now });
    second.write('{"n":3}\n');
    second.close();
    expect(names()).toEqual(["backend-2026-09-24.log"]);
    expect(readFileSync(path.join(dir, "backend-2026-09-24.log"), "utf8")).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
  });

  it("rolls to the next file when the UTC date changes, and uses UTC, not local time", () => {
    let clock = at("2026-09-24T23:59:58Z");
    const stream = new DailyLogStream({ dir, now: () => clock });
    stream.write("before-midnight\n");
    clock = at("2026-09-25T00:00:01Z");
    stream.write("after-midnight\n");
    stream.close();
    expect(readFileSync(path.join(dir, "backend-2026-09-24.log"), "utf8")).toBe("before-midnight\n");
    expect(readFileSync(path.join(dir, "backend-2026-09-25.log"), "utf8")).toBe("after-midnight\n");
  });

  it("keeps exactly 14 days: today and the 13 before it; older files are deleted at start", () => {
    const now = at("2026-09-24T12:00:00Z");
    for (let daysAgo = 0; daysAgo <= 20; daysAgo++) {
      touch(dayFile(now, daysAgo));
    }
    new DailyLogStream({ dir, now: () => now }).close();
    const kept = names();
    expect(kept).toHaveLength(LOG_RETENTION_DAYS);
    expect(kept[0]).toBe(dayFile(now, 13));
    expect(kept.at(-1)).toBe(dayFile(now, 0));
    expect(kept).not.toContain(dayFile(now, 14));
  });

  it("enforces the window at every rotation of a long-running process", () => {
    let clock = at("2026-09-01T00:00:00Z");
    const stream = new DailyLogStream({ dir, now: () => clock });
    for (let day = 0; day < 40; day++) {
      clock = new Date(at("2026-09-01T00:00:00Z").getTime() + day * 86_400_000 + 1000);
      stream.write(`day ${day}\n`);
    }
    stream.close();
    expect(names()).toHaveLength(LOG_RETENTION_DAYS);
    expect(names().at(-1)).toBe("backend-2026-10-10.log");
    expect(names()[0]).toBe("backend-2026-09-27.log");
  });

  it("deletes files of a long outage: old logs do not survive a week-long downtime", () => {
    const old = at("2026-08-01T00:00:00Z");
    touch(dayFile(old, 0));
    touch(dayFile(old, 1));
    new DailyLogStream({ dir, now: () => at("2026-09-24T00:00:00Z") }).close();
    expect(names()).toEqual([]);
  });

  it("never deletes anything that is not exactly one of our dated log files", () => {
    const now = at("2026-09-24T12:00:00Z");
    const keepers = [
      "notes.txt",
      "backend-2020-01-01.log.bak",
      "backend-2020-01-01.txt",
      "old-backend-2020-01-01.log",
      "backend-2020-1-1.log",
      "backend-current.log",
      ".gitkeep",
      "BACKEND-2020-01-01.LOG",
    ];
    for (const name of keepers) {
      touch(name);
    }
    mkdirSync(path.join(dir, "backend-2020-01-01.log.d"));
    mkdirSync(path.join(dir, "backend-2020-01-02.log")); // a DIRECTORY with a matching name
    touch("backend-2020-01-03.log");
    new DailyLogStream({ dir, now: () => now }).close();
    for (const name of keepers) {
      expect(names(), name).toContain(name);
    }
    expect(names()).toContain("backend-2020-01-01.log.d");
    expect(names()).toContain("backend-2020-01-02.log");
    expect(names()).not.toContain("backend-2020-01-03.log");
  });

  it("does not follow a symlink out of the directory when purging", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "logfiles-outside-"));
    try {
      writeFileSync(path.join(outside, "precious.txt"), "keep me");
      try {
        symlinkSync(path.join(outside, "precious.txt"), path.join(dir, "backend-2020-01-01.log"));
      } catch {
        return; // symlinks need privileges on some Windows setups: nothing to test there
      }
      purgeOldLogFiles(dir, at("2026-09-24T00:00:00Z"));
      expect(readFileSync(path.join(outside, "precious.txt"), "utf8")).toBe("keep me");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("purgeOldLogFiles returns how many it removed, and 0 for a missing directory", () => {
    const now = at("2026-09-24T00:00:00Z");
    touch(dayFile(now, 14));
    touch(dayFile(now, 30));
    touch(dayFile(now, 3));
    expect(purgeOldLogFiles(dir, now)).toBe(2);
    expect(purgeOldLogFiles(path.join(dir, "missing"), now)).toBe(0);
  });

  it("a write failure never throws: the line goes to the failure handler and later writes retry", () => {
    const failed: string[] = [];
    const stream = new DailyLogStream({ dir, now: () => at("2026-09-24T00:00:00Z"), onFailure: (l) => void failed.push(l) });
    stream.write("ok-1\n");
    rmSync(dir, { recursive: true, force: true }); // the directory disappears (disk removed, cleaned up)
    stream.close();
    expect(() => stream.write("lost?\n")).not.toThrow();
    expect(failed).toEqual(["lost?\n"]);
    mkdirSync(dir, { recursive: true });
    stream.write("ok-2\n");
    expect(readFileSync(path.join(dir, "backend-2026-09-24.log"), "utf8")).toBe("ok-2\n");
    expect(failed).toHaveLength(1);
  });

  it("never throws even when the failure handler itself throws", () => {
    const stream = new DailyLogStream({
      dir: path.join(dir, "missing"),
      now: () => at("2026-09-24T00:00:00Z"),
      onFailure: () => {
        throw new Error("stderr closed");
      },
    });
    expect(() => stream.write("x\n")).not.toThrow();
  });

  it("deletes a file dated well in the future (a wrong clock, later corrected), but not one a day ahead", () => {
    const now = at("2026-09-24T12:00:00Z");
    touch("backend-2027-01-01.log"); // months ahead: would otherwise outlive the window
    touch("backend-2026-09-27.log"); // three days ahead
    touch("backend-2026-09-26.log"); // two days ahead: within the slack, kept
    touch("backend-2026-09-25.log"); // tomorrow: kept
    purgeOldLogFiles(dir, now);
    expect(names()).toEqual(["backend-2026-09-25.log", "backend-2026-09-26.log"]);
  });

  it("a retention of 0, a negative or a fractional value can never delete today's file", () => {
    const now = at("2026-09-24T12:00:00Z");
    for (const retentionDays of [0, -5, Number.NaN, 0.4]) {
      touch("backend-2026-09-24.log");
      touch("backend-2026-09-23.log");
      purgeOldLogFiles(dir, now, retentionDays);
      expect(names(), String(retentionDays)).toEqual(["backend-2026-09-24.log"]);
    }
  });

  it("writes a long line completely", () => {
    const now = () => at("2026-09-24T12:00:00Z");
    const stream = new DailyLogStream({ dir, now });
    const line = `${"é".repeat(200_000)}\n`;
    stream.write(line);
    stream.close();
    expect(readFileSync(path.join(dir, "backend-2026-09-24.log"), "utf8")).toBe(line);
  });

  it("mtime does not matter: retention is by the date in the name", () => {
    const now = at("2026-09-24T12:00:00Z");
    touch(dayFile(now, 20));
    utimesSync(path.join(dir, dayFile(now, 20)), new Date(), new Date()); // freshly modified but 20 days old by name
    touch(dayFile(now, 1));
    utimesSync(path.join(dir, dayFile(now, 1)), at("2020-01-01T00:00:00Z"), at("2020-01-01T00:00:00Z"));
    purgeOldLogFiles(dir, now);
    expect(names()).toEqual([dayFile(now, 1)]);
  });
});

describe("createLogger with logDir", () => {
  it("writes JSON lines to the day's file, still redacting secrets, and nothing to stdout", () => {
    const logger = createLogger({ level: "info", logDir: dir });
    logger.info({ req: { headers: { authorization: "Bearer super-secret", cookie: "sd_session=abc" } } }, "request");
    const [file] = names();
    expect(file).toMatch(/^backend-\d{4}-\d{2}-\d{2}\.log$/);
    const text = readFileSync(path.join(dir, file), "utf8");
    const line = JSON.parse(text.trim());
    expect(line).toMatchObject({ level: 30, msg: "request" });
    expect(text).toContain("[Redacted]");
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("sd_session=abc");
  });

  it("an explicit destination wins over logDir (tests)", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", logDir: dir }, { write: (l: string) => void lines.push(l) });
    logger.info("hello");
    expect(lines).toHaveLength(1);
    expect(names()).toEqual([]);
  });

  it("without logDir it does not create any file", () => {
    createLogger({ level: "silent" });
    expect(names()).toEqual([]);
  });
});

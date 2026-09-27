import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// node:fs/promises is a builtin ESM module whose namespace vitest can't spy on directly
// ("Cannot redefine property"), so failures are injected through a full vi.mock instead, gated
// by this flag (reset in afterEach) rather than by per-test module resets.
const failures: { rename?: Error; writeFile?: Error } = {};
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: string, data: string, encoding: string) => {
      if (failures.writeFile) {
        // Simulate a partial/failed write: something did land on disk before the failure, the
        // same as a real ENOSPC/EPERM mid-write would likely leave behind.
        await actual.writeFile(file, "{", "utf8");
        throw failures.writeFile;
      }
      return actual.writeFile(file, data, encoding as BufferEncoding);
    },
    rename: async (oldPath: string, newPath: string) => {
      if (failures.rename) throw failures.rename;
      return actual.rename(oldPath, newPath);
    },
  };
});

const { writeRunFile } = await import("./runFile.js");

const dirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "satis-run-file-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  delete failures.rename;
  delete failures.writeFile;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeRunFile", () => {
  it("writes {commit, pid, startedAt} to <dir>/backend.json", async () => {
    const dir = await freshDir();
    await writeRunFile(dir, { commit: "abc1234", pid: 4242, startedAt: "2026-09-27T10:00:00.000Z" });
    const content = JSON.parse(await readFile(path.join(dir, "backend.json"), "utf8"));
    expect(content).toEqual({ commit: "abc1234", pid: 4242, startedAt: "2026-09-27T10:00:00.000Z" });
  });

  it("creates the directory if it doesn't exist yet", async () => {
    const parent = await freshDir();
    const nested = path.join(parent, "nested", "run");
    await writeRunFile(nested, { commit: "x", pid: 1, startedAt: "2026-09-27T10:00:00.000Z" });
    expect(JSON.parse(await readFile(path.join(nested, "backend.json"), "utf8"))).toMatchObject({ commit: "x" });
  });

  it("leaves no leftover temp file after a successful write (the rename replaces it, it doesn't add to it)", async () => {
    const dir = await freshDir();
    await writeRunFile(dir, { commit: "a", pid: 1, startedAt: "2026-09-27T10:00:00.000Z" });
    expect(await readdir(dir)).toEqual(["backend.json"]);
  });

  it("overwrites a previous run file with the new one (a restart's info replaces the old process's)", async () => {
    const dir = await freshDir();
    await writeRunFile(dir, { commit: "old", pid: 1, startedAt: "2026-09-27T09:00:00.000Z" });
    await writeRunFile(dir, { commit: "new", pid: 2, startedAt: "2026-09-27T10:00:00.000Z" });
    expect(JSON.parse(await readFile(path.join(dir, "backend.json"), "utf8"))).toEqual({
      commit: "new",
      pid: 2,
      startedAt: "2026-09-27T10:00:00.000Z",
    });
    expect(await readdir(dir)).toEqual(["backend.json"]);
  });

  it("does nothing, and never throws, when no directory is given", async () => {
    await expect(writeRunFile(undefined, { commit: "x", pid: 1, startedAt: "2026-09-27T10:00:00.000Z" })).resolves.toBeUndefined();
    await expect(writeRunFile("", { commit: "x", pid: 1, startedAt: "2026-09-27T10:00:00.000Z" })).resolves.toBeUndefined();
  });

  // Regression test for a bug test-hunter found and this PR fixed: writeRunFile originally had no
  // try/finally around the temp-file write and rename, so a failure between "the temp file exists"
  // and "the rename lands" left the temp file on disk forever. It's not a deploy-correctness bug
  // (deploy-update.ps1 only ever reads backend.json, never the temp file), but it was a real,
  // unbounded local disk leak on every failed write. Fixed with a try/catch that unlinks the temp
  // file before rethrowing.
  it("cleans up the temp file when the rename step fails, and still rejects", async () => {
    const dir = await freshDir();
    failures.rename = new Error("simulated rename failure (e.g. EPERM from an AV scanner)");
    await expect(writeRunFile(dir, { commit: "a", pid: 999, startedAt: "2026-09-27T10:00:00.000Z" })).rejects.toThrow();
    const entries = await readdir(dir);
    expect(entries).not.toContain("backend.json"); // the rename never happened
    expect(entries).not.toContain(".backend.json.999.tmp"); // and the temp file was cleaned up
  });

  it("cleans up the temp file when the write step itself fails, and still rejects", async () => {
    const dir = await freshDir();
    failures.writeFile = new Error("simulated write failure (e.g. ENOSPC)");
    await expect(writeRunFile(dir, { commit: "a", pid: 888, startedAt: "2026-09-27T10:00:00.000Z" })).rejects.toThrow();
    const entries = await readdir(dir);
    expect(entries).not.toContain("backend.json");
    expect(entries).not.toContain(".backend.json.888.tmp");
  });
});

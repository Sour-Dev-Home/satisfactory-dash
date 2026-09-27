import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeRunFile } from "./runFile.js";

const dirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "satis-run-file-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
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
});

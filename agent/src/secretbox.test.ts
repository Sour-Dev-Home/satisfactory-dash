import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSecretBoxError, createSecretBox, fileSecretBox, resolveSecretStoreKind, writeFileAtomic } from "./secretbox.js";
import { AgentStore, resolveDataDir } from "./store.js";

const posix = process.platform !== "win32";
const posixIt = it.skipIf(!posix); // POSIX modes and symlinks: not meaningful on Windows (which uses DPAPI)

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "sd-secretbox-"));
  dir = path.join(root, "state");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const modeOf = (p: string) => statSync(p).mode & 0o777;

describe("fileSecretBox", () => {
  it("round-trips a secret and refuses an empty one or a malformed blob", async () => {
    const box = fileSecretBox(dir);
    expect(await box.unprotect(await box.protect("s3cret-Ünï"))).toBe("s3cret-Ünï");
    await expect(box.protect("")).rejects.toBeInstanceOf(FileSecretBoxError);
    await expect(box.unprotect("not base64!")).rejects.toThrow(/not in the expected form/);
  });

  posixIt("creates the state directory 0700 and the store file 0600, and tightens a looser directory", async () => {
    const store = AgentStore.open(dir, fileSecretBox(dir));
    await store.setSecret("apiToken", "tok-VALUE");
    expect(modeOf(dir)).toBe(0o700);
    expect(modeOf(path.join(dir, "store.json"))).toBe(0o600);
    chmodSync(dir, 0o755);
    await fileSecretBox(dir).protect("x");
    expect(modeOf(dir)).toBe(0o700);
  });

  posixIt("refuses a store file looser than 0600 with the path and a chmod hint, and no secret in the message", async () => {
    const store = AgentStore.open(dir, fileSecretBox(dir));
    await store.setSecret("apiToken", "tok-VALUE-NEVER-SHOWN");
    const file = path.join(dir, "store.json");
    chmodSync(file, 0o644);
    const error = await AgentStore.open(dir, fileSecretBox(dir)).getSecret("apiToken").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileSecretBoxError);
    const message = (error as Error).message;
    expect(message).toContain(file);
    expect(message).toContain(`chmod 600 ${file}`);
    expect(message).not.toContain("tok-VALUE-NEVER-SHOWN");
    expect(message).not.toContain(Buffer.from("tok-VALUE-NEVER-SHOWN").toString("base64"));
    chmodSync(file, 0o640); // group-readable is refused too
    await expect(fileSecretBox(dir).unprotect("YQ==")).rejects.toThrow(/permissions 640/);
    chmodSync(file, 0o400); // stricter than 0600 is fine
    await expect(fileSecretBox(dir).unprotect("YQ==")).resolves.toBe("a");
  });

  posixIt("refuses a store file that is a symlink, even to a 0600 target", async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = path.join(root, "elsewhere.json");
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, path.join(dir, "store.json"));
    await expect(fileSecretBox(dir).protect("x")).rejects.toThrow(/symbolic link/);
  });

  posixIt("refuses a state directory that is a symlink", async () => {
    const real = path.join(root, "real");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, dir);
    await expect(fileSecretBox(dir).protect("x")).rejects.toThrow(/symbolic link/);
  });
});

describe("writeFileAtomic", () => {
  posixIt("writes 0600 and replaces the old content whole", () => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "a.json");
    writeFileAtomic(file, "one");
    writeFileAtomic(file, "two");
    expect(readFileSync(file, "utf8")).toBe("two");
    expect(modeOf(file)).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  posixIt("a failure mid-write leaves the old file intact and no temporary file", () => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "a.json");
    writeFileAtomic(file, "old");
    // A directory squatting on the target makes the final rename fail after the temp file was fully written.
    const blocked = path.join(dir, "b.json");
    mkdirSync(blocked);
    expect(() => writeFileAtomic(blocked, "new")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("old");
    expect(readdirSync(dir).sort()).toEqual(["a.json", "b.json"]);
  });
});

describe("secret store selection", () => {
  it("picks by platform, and SD_AGENT_SECRET_STORE overrides it", () => {
    expect(resolveSecretStoreKind({}, "win32")).toBe("dpapi");
    expect(resolveSecretStoreKind({}, "linux")).toBe("file");
    expect(resolveSecretStoreKind({ SD_AGENT_SECRET_STORE: "" }, "linux")).toBe("file");
    expect(resolveSecretStoreKind({ SD_AGENT_SECRET_STORE: "file" }, "win32")).toBe("file");
    expect(resolveSecretStoreKind({ SD_AGENT_SECRET_STORE: "dpapi" }, "linux")).toBe("dpapi");
  });

  it("anything else is a startup error naming the variable", () => {
    for (const bad of ["DPAPI", "keyring", "plain", " file"]) {
      expect(() => resolveSecretStoreKind({ SD_AGENT_SECRET_STORE: bad }, "linux")).toThrow(/SD_AGENT_SECRET_STORE/);
      expect(() => createSecretBox({ dir, env: { SD_AGENT_SECRET_STORE: bad }, platform: "linux" })).toThrow(FileSecretBoxError);
    }
  });

  it("builds the file box off Windows and DPAPI (which is unavailable off Windows) when forced", async () => {
    const box = createSecretBox({ dir, env: {}, platform: "linux" });
    expect(await box.unprotect(await box.protect("v"))).toBe("v");
    const forced = createSecretBox({ dir, env: { SD_AGENT_SECRET_STORE: "dpapi" }, platform: "linux" });
    await expect(forced.protect("v")).rejects.toThrow(/DPAPI is only available on Windows/);
  });
});

describe("resolveDataDir with STATE_DIRECTORY", () => {
  const home = path.join(path.sep, "home", "u");
  posixIt("uses STATE_DIRECTORY before the home folder, and the first entry of a list", () => {
    const state = path.resolve(path.sep, "var", "lib", "sd-agent");
    expect(resolveDataDir({ STATE_DIRECTORY: state }, home)).toBe(state);
    expect(resolveDataDir({ STATE_DIRECTORY: `${state}:${path.resolve(path.sep, "other")}` }, home)).toBe(state);
  });
  posixIt("falls through when it is empty, and SD_AGENT_HOME still wins", () => {
    expect(resolveDataDir({ STATE_DIRECTORY: "" }, home)).toBe(path.join(home, ".satisfactory-dash-agent"));
    expect(resolveDataDir({ STATE_DIRECTORY: ":x" }, home)).toBe(path.join(home, ".satisfactory-dash-agent"));
    const explicit = path.resolve(path.sep, "explicit");
    expect(resolveDataDir({ SD_AGENT_HOME: explicit, STATE_DIRECTORY: path.resolve(path.sep, "s") }, home)).toBe(explicit);
  });
  it("leaves Windows unchanged: LOCALAPPDATA wins over STATE_DIRECTORY", () => {
    expect(resolveDataDir({ LOCALAPPDATA: "C:\\L", STATE_DIRECTORY: path.resolve(path.sep, "s") }, home)).toBe(path.join("C:\\L", "satisfactory-dash-agent"));
  });
});

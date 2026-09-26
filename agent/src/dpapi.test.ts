import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DpapiError, PROTECT_SCRIPT, UNPROTECT_SCRIPT, createDpapi } from "./dpapi.js";
import type { Spawner } from "./dpapi.js";

const onWindows = process.platform === "win32";
const SECRET = "tok_Zm9vYmFyLXNlY3JldC12YWx1ZS0xMjM0NTY3ODkw.abc-DEF_ghi";

/** A stand-in for the child: records what is written to stdin, and answers when told to. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { end: (data?: string) => void; written: string[] }; stdout: EventEmitter; stderr: EventEmitter; kill: () => void; killed: boolean };
  const stdin = Object.assign(new EventEmitter(), {
    written: [] as string[],
    end(data?: string) {
      if (data !== undefined) stdin.written.push(data);
    },
  });
  child.stdin = stdin;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function spawnerFor(child: ReturnType<typeof fakeChild>) {
  const calls: { command: string; args: string[] }[] = [];
  const spawner: Spawner = (command, args) => {
    calls.push({ command, args });
    return child as unknown as ReturnType<Spawner>;
  };
  return { spawner, calls };
}

afterEach(() => vi.useRealTimers());

describe("what is handed to PowerShell (architect rule: the plaintext only on stdin)", () => {
  it("protect: the secret is on stdin as base64, and appears in no argument, in plain or base64 form", async () => {
    const child = fakeChild();
    const { spawner, calls } = spawnerFor(child);
    const pending = createDpapi({ platform: "win32", env: { SystemRoot: "C:\\Windows" }, spawner }).protect(SECRET);
    child.stdout.emit("data", Buffer.from("cHJvdGVjdGVk"));
    child.emit("close", 0);
    expect(await pending).toBe("cHJvdGVjdGVk");

    expect(child.stdin.written).toEqual([Buffer.from(SECRET, "utf8").toString("base64")]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"); // absolute: PATH cannot substitute it
    const everything = [call.command, ...call.args].join("\n");
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(Buffer.from(SECRET, "utf8").toString("base64"));
    expect(call.args).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PROTECT_SCRIPT]);
  });

  it("unprotect: the blob is on stdin, the script is the fixed constant, and the answer is decoded from base64", async () => {
    const child = fakeChild();
    const { spawner, calls } = spawnerFor(child);
    const blob = "AQAAANCMnd8BFdERjHoAwE/Cl+s=";
    const pending = createDpapi({ platform: "win32", env: {}, spawner }).unprotect(blob);
    child.stdout.emit("data", Buffer.from(Buffer.from(SECRET, "utf8").toString("base64")));
    child.emit("close", 0);
    expect(await pending).toBe(SECRET);
    expect(child.stdin.written).toEqual([blob]);
    expect(calls[0]!.args.at(-1)).toBe(UNPROTECT_SCRIPT);
    expect(calls[0]!.command).toBe("powershell.exe"); // no SystemRoot: the bare name, still no secret in it
  });

  it("the scripts are fixed text: CurrentUser scope, System.Security loaded (Windows PowerShell 5.1), no interpolation slots", () => {
    for (const script of [PROTECT_SCRIPT, UNPROTECT_SCRIPT]) {
      expect(script).toContain("Add-Type -AssemblyName System.Security");
      expect(script).toContain("DataProtectionScope]::CurrentUser");
      expect(script).not.toMatch(/LocalMachine/);
      expect(script).not.toMatch(/\$\{|`/); // no template slot left over
      expect(script).toContain("[Console]::In.ReadToEnd()");
    }
    expect(PROTECT_SCRIPT).toContain("ProtectedData]::Protect");
    expect(UNPROTECT_SCRIPT).toContain("ProtectedData]::Unprotect");
  });

  it("an empty secret is never protected, and a blob that is not base64 never reaches PowerShell", async () => {
    const spawner = vi.fn() as unknown as Spawner;
    const dpapi = createDpapi({ platform: "win32", spawner });
    await expect(dpapi.protect("")).rejects.toMatchObject({ kind: "protect_failed" });
    for (const bad of ["", "not base64!", "abc;calc", "$(whoami)", "a b"]) {
      await expect(dpapi.unprotect(bad), bad).rejects.toMatchObject({ kind: "unprotect_failed" });
    }
    expect(spawner).not.toHaveBeenCalled();
  });
});

describe("failing loudly and clearly", () => {
  it("a non-zero exit is a DpapiError that says what to do, and carries none of the child's output", async () => {
    const child = fakeChild();
    const { spawner } = spawnerFor(child);
    const pending = createDpapi({ platform: "win32", spawner }).unprotect("AAAA");
    child.stderr.emit("data", Buffer.from(`Exception calling "Unprotect" ... ${SECRET}`));
    child.emit("close", 1);
    const error = await pending.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DpapiError);
    expect((error as DpapiError).kind).toBe("unprotect_failed");
    expect((error as DpapiError).message).toContain("same Windows user");
    expect((error as DpapiError).message).toContain("(exit 1)");
    expect((error as DpapiError).message).not.toContain(SECRET);
  });

  it("empty output with exit 0 is a failure, not an empty secret", async () => {
    const child = fakeChild();
    const { spawner } = spawnerFor(child);
    const pending = createDpapi({ platform: "win32", spawner }).unprotect("AAAA");
    child.emit("close", 0);
    await expect(pending).rejects.toMatchObject({ kind: "unprotect_failed" });
  });

  it("PowerShell that cannot start, or does not answer, is a DpapiError (the child is killed on a timeout)", async () => {
    const missing = fakeChild();
    const first = createDpapi({ platform: "win32", spawner: spawnerFor(missing).spawner }).protect(SECRET);
    missing.emit("error", new Error("spawn ENOENT"));
    await expect(first).rejects.toMatchObject({ kind: "protect_failed", message: expect.stringContaining("could not be started") });

    vi.useFakeTimers();
    const hung = fakeChild();
    const second = createDpapi({ platform: "win32", spawner: spawnerFor(hung).spawner }).unprotect("AAAA");
    const settled = second.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(hung.killed).toBe(true);
    expect(await settled).toBeInstanceOf(DpapiError);
  });

  it("off Windows every call says DPAPI is unavailable, and starts nothing", async () => {
    const spawner = vi.fn() as unknown as Spawner;
    const dpapi = createDpapi({ platform: "linux", spawner });
    await expect(dpapi.protect(SECRET)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(dpapi.unprotect("AAAA")).rejects.toMatchObject({ kind: "unavailable" });
    expect(spawner).not.toHaveBeenCalled();
  });
});

// The real thing: only where DPAPI exists. CI runs on Linux and skips these; run them on the Windows dev machine.
describe.skipIf(!onWindows)("real DPAPI round trips (Windows only)", () => {
  const dpapi = createDpapi();

  it("protect then unprotect returns the secret, including non-ASCII and long values", async () => {
    for (const secret of [SECRET, "kärna-ünïcode-秘密-🔐", "x".repeat(4000), "with spaces and \"quotes\" and $dollar and `ticks` and 'single'", "line1\nline2"]) {
      const blob = await dpapi.protect(secret);
      expect(blob).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(blob).not.toContain(secret);
      expect(await dpapi.unprotect(blob)).toBe(secret);
    }
  }, 60_000);

  it("the blob is not the plaintext or its base64, and two protections of one secret differ (DPAPI salts them)", async () => {
    const a = await dpapi.protect(SECRET);
    const b = await dpapi.protect(SECRET);
    expect(a).not.toBe(b);
    for (const blob of [a, b]) {
      expect(Buffer.from(blob, "base64").toString("latin1")).not.toContain(SECRET);
      expect(blob).not.toContain(Buffer.from(SECRET).toString("base64"));
    }
  }, 60_000);

  it("a blob that is valid base64 but not a DPAPI blob is a clear DpapiError", async () => {
    const error = await dpapi.unprotect(Buffer.from("this is not a dpapi blob at all").toString("base64")).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DpapiError);
    expect((error as DpapiError).kind).toBe("unprotect_failed");
    expect((error as DpapiError).message).toContain("same Windows user");
  }, 60_000);

  it("a corrupted real blob is refused, not decoded to garbage", async () => {
    const blob = Buffer.from(await dpapi.protect(SECRET), "base64");
    blob[blob.length - 3] = blob[blob.length - 3]! ^ 0xff;
    await expect(dpapi.unprotect(blob.toString("base64"))).rejects.toBeInstanceOf(DpapiError);
  }, 60_000);
});

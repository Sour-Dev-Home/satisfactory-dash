import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChildHandle, SpawnFn } from "./supervisor";
import { runUpdate, SERVER_APP_ID, steamcmdArgs } from "./updater";

/** A fake SteamCMD the test drives: output chunks, then an exit or an error. */
class FakeTool implements ChildHandle {
  readonly pid = 4242;
  private out: ((chunk: string) => void)[] = [];
  private exits: ((code: number | null, signal: string | null) => void)[] = [];
  private errors: ((err: Error) => void)[] = [];
  kill(): void {}
  onSpawn(): void {}
  onExit(cb: (code: number | null, signal: string | null) => void): void {
    this.exits.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this.errors.push(cb);
  }
  onOutput(cb: (chunk: string) => void): void {
    this.out.push(cb);
  }
  write(chunk: string): void {
    for (const cb of this.out) cb(chunk);
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const cb of this.exits) cb(code, signal);
  }
  fail(err: Error): void {
    for (const cb of this.errors) cb(err);
  }
}

function run(serverDir = "D:\\Games\\Satisfactory Server") {
  const tool = new FakeTool();
  const calls: { file: string; args: readonly string[] }[] = [];
  const lines: string[] = [];
  const spawn: SpawnFn = (file, args) => {
    calls.push({ file, args });
    return tool;
  };
  const result = runUpdate({ steamcmdDir: "D:\\steamcmd", serverDir, spawn, onLine: (l) => lines.push(l) });
  return { tool, calls, lines, result };
}

describe("runUpdate", () => {
  it("runs steamcmd.exe from the SteamCMD folder with exactly the update arguments", () => {
    const { calls } = run();
    expect(calls).toEqual([
      {
        file: join("D:\\steamcmd", "steamcmd.exe"),
        args: [
          "+force_install_dir",
          "D:\\Games\\Satisfactory Server",
          "+login",
          "anonymous",
          "+app_update",
          "1690800",
          "validate",
          "+quit",
        ],
      },
    ]);
    expect(SERVER_APP_ID).toBe("1690800");
  });

  it("streams output a line at a time and reports success on exit 0", async () => {
    const { tool, lines, result } = run();
    tool.write("Redirecting stderr\r\nUpdate state (0x61) downloading, progress: 12.50");
    tool.write(" (100 / 800)\n");
    tool.write("Success! App '1690800' fully installed.\n");
    tool.exit(0);
    await expect(result).resolves.toEqual({ ok: true, code: 0 });
    expect(lines).toEqual([
      "Redirecting stderr",
      "Update state (0x61) downloading, progress: 12.50 (100 / 800)",
      "Success! App '1690800' fully installed.",
    ]);
  });

  it("reports a non-zero exit code as a failure", async () => {
    const { tool, result } = run();
    tool.exit(8);
    await expect(result).resolves.toEqual({ ok: false, code: 8 });
  });

  it("edge: a last line without a newline is still passed on, and blank lines are dropped", async () => {
    const { tool, lines, result } = run();
    tool.write("\n\n  \nfirst\rsecond");
    tool.exit(0);
    await result;
    expect(lines).toEqual(["first", "second"]);
  });

  it("edge: a spawn error is a failure with the reason, reported once even if an exit follows", async () => {
    const { tool, lines, result } = run();
    tool.fail(new Error("spawn ENOENT"));
    tool.exit(-2);
    await expect(result).resolves.toEqual({ ok: false, code: -1 });
    expect(lines).toEqual(["Could not start SteamCMD: spawn ENOENT"]);
  });

  it("edge: a spawn that throws resolves as a failure, never rejects", async () => {
    const lines: string[] = [];
    const result = await runUpdate({
      steamcmdDir: "D:\\steamcmd",
      serverDir: "D:\\server",
      spawn: () => {
        throw new Error("EACCES");
      },
      onLine: (l) => lines.push(l),
    });
    expect(result).toEqual({ ok: false, code: -1 });
    expect(lines).toEqual(["Could not start SteamCMD: EACCES"]);
  });

  it("edge: an exit by signal (no code) is a failure", async () => {
    const { tool, result } = run();
    tool.exit(null, "SIGTERM");
    await expect(result).resolves.toEqual({ ok: false, code: -1 });
  });

  it("edge: a throwing line listener doesn't lose the result", async () => {
    const tool = new FakeTool();
    const result = runUpdate({
      steamcmdDir: "D:\\steamcmd",
      serverDir: "D:\\server",
      spawn: () => tool,
      onLine: () => {
        throw new Error("window gone");
      },
    });
    tool.write("a\n");
    tool.exit(0);
    await expect(result).resolves.toEqual({ ok: true, code: 0 });
  });

  it("edge: a trailing separator on the server folder is dropped, a drive root keeps its own", () => {
    expect(steamcmdArgs("D:\\My Server\\")[1]).toBe("D:\\My Server");
    expect(steamcmdArgs("D:\\My Server\\\\")[1]).toBe("D:\\My Server");
    expect(steamcmdArgs("/srv/sf/")[1]).toBe("/srv/sf");
    expect(steamcmdArgs("D:\\")[1]).toBe("D:\\");
    expect(steamcmdArgs("/")[1]).toBe("/");
  });
});

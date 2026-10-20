// ADR-0040 decision 6: the app opens no port. Playwright's Electron launcher adds its own debugging ports to the main
// process, so this test starts the built app directly and asks the OS which sockets that process is listening on.
import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { appDir, appEnv, makeFixture, removeFixture, writeSettings } from "./harness";

const electronPath = createRequire(import.meta.url)("electron") as string;

/** Listening TCP sockets and bound UDP endpoints owned by `pid`, as the OS reports them (locale-independent). */
function listeners(pid: number): string[] {
  if (process.platform === "win32") {
    const script =
      "$p = [int]$env:SM_PID; " +
      "@(Get-NetTCPConnection -State Listen -OwningProcess $p -ErrorAction SilentlyContinue | % { \"tcp $($_.LocalAddress):$($_.LocalPort)\" }) + " +
      "@(Get-NetUDPEndpoint -OwningProcess $p -ErrorAction SilentlyContinue | % { \"udp $($_.LocalAddress):$($_.LocalPort)\" })";
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, SM_PID: String(pid) },
      encoding: "utf8",
    });
    return out.split(/\r?\n/).filter((line) => line.trim() !== "");
  }
  const out = execFileSync("ss", ["-H", "-l", "-n", "-p", "-t", "-u"], { encoding: "utf8" });
  return out.split("\n").filter((line) => line.includes(`pid=${pid},`));
}

test("the socket probe sees a process that does listen (so an empty answer below means something)", async () => {
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0, '127.0.0.1', () => console.log('up'))"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    await new Promise<void>((resolve) => server.stdout!.once("data", () => resolve()));
    expect(listeners(server.pid!).length).toBeGreaterThan(0);
  } finally {
    server.kill();
  }
});

test("the main process creates no listening socket", async () => {
  const f = makeFixture();
  writeSettings(f);
  let app: ChildProcess | undefined;
  try {
    app = spawn(electronPath, [appDir], { cwd: appDir, env: appEnv(f), stdio: ["ignore", "pipe", "inherit"] });
    const pid = app.pid!;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the app never said it was ready")), 30_000);
      let out = "";
      app!.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes("server-manager: ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      app!.on("exit", (code) => reject(new Error(`the app exited early (${code})`)));
    });
    // Give anything started after the page loaded a moment to bind.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(listeners(pid)).toEqual([]);
  } finally {
    // Wait for it to be gone: Electron's profile sits in the fixture's data folder and stays locked until then.
    if (app && app.exitCode === null && app.signalCode === null) {
      const exited = new Promise((resolve) => app!.once("exit", resolve));
      app.kill();
      await exited;
    }
    removeFixture(f);
  }
});

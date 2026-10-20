/**
 * The real SpawnFn: node's spawn with no shell, the server's folder as cwd and no console window. The supervisor
 * passes the configured FactoryServer.exe and the fixed arguments; nothing else is ever run here.
 *
 * RUN_WITH_NODE_ENV=1 is the e2e tests' switch: the same configured file is run as a Node script through Electron
 * (ELECTRON_RUN_AS_NODE), because the fake server is a script and CI is Linux. It never changes WHICH file runs.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { dirname } from "node:path";
import type { SpawnFn } from "./supervisor";

export const RUN_WITH_NODE_ENV = "SATISFACTORY_SERVER_MANAGER_TEST_RUN_WITH_NODE";

export type NodeSpawn = (file: string, args: string[], opts: SpawnOptions) => ChildProcess;

export function serverSpawn(opts: { env: NodeJS.ProcessEnv; execPath: string; spawn?: NodeSpawn }): SpawnFn {
  const spawn = opts.spawn ?? nodeSpawn;
  const viaNode = opts.env[RUN_WITH_NODE_ENV] === "1";
  return (exe, args) => {
    const common = { cwd: dirname(exe), shell: false, windowsHide: true, stdio: "ignore" as const };
    const child = viaNode
      ? spawn(opts.execPath, [exe, ...args], { ...common, env: { ...opts.env, ELECTRON_RUN_AS_NODE: "1" } })
      : spawn(exe, [...args], { ...common, env: { ...opts.env } });
    return {
      get pid() {
        return child.pid;
      },
      kill: () => {
        child.kill();
      },
      onSpawn: (cb) => {
        child.on("spawn", cb);
      },
      onExit: (cb) => {
        child.on("exit", (code, signal) => cb(code, signal));
      },
      onError: (cb) => {
        child.on("error", cb);
      },
    };
  };
}

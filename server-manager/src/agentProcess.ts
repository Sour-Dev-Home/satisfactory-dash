/**
 * The real RunFn for the agent panel, and the agent commands the window may run. It runs exactly two things, each a
 * fixed file with an argument array and no shell: Windows PowerShell from System32 (agentTask.ts's fixed scripts), and
 * the built agent, `node <checkout>\agent\dist\agent.cjs <command>`. The agent's path is derived from where this app
 * sits in the checkout, never configured; its Node is Electron's own (ELECTRON_RUN_AS_NODE), so no PATH lookup.
 *
 * RUN_WITH_NODE_ENV=1, the e2e switch, runs `e2e/fake-agent.cjs` (also a fixed path beside this app) for both, so a
 * test never reaches the real Task Scheduler or agent. Nothing the window sends can choose what runs.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AGENT_COMMANDS, agentCommandRequested, type AgentCommandResult } from "./ipc";
import type { Program, RunFn, RunResult } from "./agentTask";
import { powershellPath } from "./processStats";
import { RUN_WITH_NODE_ENV, type NodeSpawn } from "./serverProcess";

export { AGENT_COMMANDS };

export const AGENT_NOT_BUILT = "The agent isn't built in this checkout: run `npm run build -w agent`, then try again.";

const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

/** `<checkout>/agent/dist/agent.cjs`, from the folder main.cjs runs in (`<checkout>/server-manager/dist`). */
export function agentScriptPath(mainDir: string): string {
  return resolve(mainDir, "..", "..", "agent", "dist", "agent.cjs");
}

/** The e2e tests' stand-in for PowerShell and the agent; used only under the e2e switch. */
export function fakeAgentToolsPath(mainDir: string): string {
  return resolve(mainDir, "..", "e2e", "fake-agent.cjs");
}

const keepEnd = (text: string) => (text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text);

export function createRun(opts: {
  env: NodeJS.ProcessEnv;
  execPath: string;
  mainDir: string;
  spawn?: NodeSpawn;
  exists?: (path: string) => boolean;
  timeoutMs?: number;
}): RunFn {
  const spawn = opts.spawn ?? nodeSpawn;
  const exists = opts.exists ?? existsSync;
  const fake = opts.env[RUN_WITH_NODE_ENV] === "1";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const asNode = { ...opts.env, ELECTRON_RUN_AS_NODE: "1" };

  const command = (program: Program, args: readonly string[]): { file: string; args: string[]; env: NodeJS.ProcessEnv } => {
    if (program !== "powershell" && program !== "agent") throw new Error("not a program this app runs");
    if (fake) return { file: opts.execPath, args: [fakeAgentToolsPath(opts.mainDir), program, ...args], env: asNode };
    if (program === "powershell") return { file: powershellPath(opts.env), args: [...args], env: { ...opts.env } };
    const script = agentScriptPath(opts.mainDir);
    if (!exists(script)) throw new Error(AGENT_NOT_BUILT);
    return { file: opts.execPath, args: [script, ...args], env: asNode };
  };

  return (program, args) =>
    new Promise<RunResult>((resolvePromise, reject) => {
      const { file, args: argv, env } = command(program, args);
      const child = spawn(file, argv, {
        cwd: dirname(file),
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout = keepEnd(stdout + chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr = keepEnd(stderr + chunk);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolvePromise({ code: timedOut ? null : code, stdout, stderr });
      });
    });
}

/** Runs one of the AGENT_COMMANDS and gives back what it printed; anything else the window asks for is refused. */
export async function runAgentCommand(run: RunFn, requested: unknown): Promise<AgentCommandResult> {
  const command = agentCommandRequested(requested);
  if (command === undefined) throw new Error("not an agent command the window may run");
  try {
    const result = await run("agent", [command]);
    const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((part) => part !== "").join("\n");
    return { command, exitCode: result.code, output };
  } catch (err) {
    return { command, exitCode: null, output: err instanceof Error ? err.message : String(err) };
  }
}

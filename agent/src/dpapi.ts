import { spawn } from "node:child_process";

/**
 * Windows DPAPI through PowerShell's ProtectedData (ADR-0031 PR 6): a secret at rest is encrypted for the CURRENT Windows
 * user, so a copy of the store file on another machine or account is useless. No native module.
 *
 * The rules (architect):
 *  - The plaintext travels ONLY on the child's stdin, as base64 of its UTF-8 bytes. Never in an argument, never in the
 *    environment: command lines and environments are visible to other processes and to process-audit logs.
 *  - The PowerShell script is a fixed constant with no interpolation, so nothing a caller passes can become code.
 *  - Scope is CurrentUser, and `Add-Type -AssemblyName System.Security` loads ProtectedData in Windows PowerShell 5.1.
 *  - Failure is loud and clear (`DpapiError`), never a silent empty secret, and the error text carries no output of the
 *    child (it could echo a fragment of what it was fed).
 *
 * A DPAPI CurrentUser key is only available to a process that runs as that user WITH the user's profile loaded: not to an
 * S4U ("do not store password") Scheduled Task [NEEDS VERIFICATION on this Windows build]; see the runbook.
 */

export type DpapiErrorKind = "unavailable" | "protect_failed" | "unprotect_failed";

export class DpapiError extends Error {
  constructor(
    readonly kind: DpapiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DpapiError";
  }
}

export interface Dpapi {
  /** Encrypts for the current Windows user; returns base64 of the protected bytes. */
  protect(plaintext: string): Promise<string>;
  /** Decrypts what `protect` returned, as the same Windows user. Throws `DpapiError` when it cannot. */
  unprotect(blob: string): Promise<string>;
}

const SCRIPT_HEAD = "Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd().Trim(); $bytes = [Convert]::FromBase64String($in); ";
const SCOPE = "[System.Security.Cryptography.DataProtectionScope]::CurrentUser";
export const PROTECT_SCRIPT = `${SCRIPT_HEAD}[Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, ${SCOPE})))`;
export const UNPROTECT_SCRIPT = `${SCRIPT_HEAD}[Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, ${SCOPE})))`;

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 1_000_000;

/** What starts the child: injectable so tests can watch exactly what is passed (and what is not). */
export type Spawner = (command: string, args: string[]) => ReturnType<typeof spawn>;

function powershellPath(env: NodeJS.ProcessEnv): string {
  // The absolute path, so a PATH entry cannot substitute another program.
  const root = env.SystemRoot ?? env.windir;
  return root !== undefined && root !== "" ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe";
}

async function run(script: string, input: string, kind: "protect_failed" | "unprotect_failed", spawner: Spawner, env: NodeJS.ProcessEnv): Promise<string> {
  const failure = (message: string) => new DpapiError(kind, message);
  const explain =
    kind === "unprotect_failed"
      ? "Windows could not unprotect the agent's store. Run the agent as the same Windows user that set it up, with a logon type that loads that user's profile (not a 'do not store password' task); see the runbook."
      : "Windows could not protect a secret for the agent's store.";
  return new Promise<string>((resolve, reject) => {
    // The plaintext (as base64) is written to stdin below and appears in no argument.
    const child = spawner(powershellPath(env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    let stdout = "";
    let settled = false;
    const finish = (error: DpapiError | undefined, value = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(failure(`${explain} (PowerShell did not answer in ${TIMEOUT_MS / 1000} seconds)`));
    }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_CHARS) {
        child.kill();
        finish(failure(explain));
      }
    });
    child.stderr?.on("data", () => undefined); // drained and discarded: never surfaced, it could echo input
    child.on("error", () => finish(failure(`${explain} (PowerShell could not be started)`)));
    child.on("close", (code) => finish(code === 0 && stdout.length > 0 ? undefined : failure(`${explain} (exit ${code ?? "none"})`), stdout.trim()));
    child.stdin?.on("error", () => undefined); // a child that exits early closes the pipe; the exit code reports it
    child.stdin?.end(input);
  });
}

/** The real DPAPI, on Windows. Off Windows every call throws `unavailable` (the agent is a Windows app). */
export function createDpapi(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; spawner?: Spawner } = {}): Dpapi {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawner: Spawner = options.spawner ?? ((command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }));
  const unavailable = () => new DpapiError("unavailable", "Windows DPAPI is only available on Windows; the agent stores its secrets with it and cannot run elsewhere.");
  return {
    async protect(plaintext) {
      if (platform !== "win32") throw unavailable();
      if (plaintext === "") throw new DpapiError("protect_failed", "An empty secret is not stored.");
      return run(PROTECT_SCRIPT, Buffer.from(plaintext, "utf8").toString("base64"), "protect_failed", spawner, env);
    },
    async unprotect(blob) {
      if (platform !== "win32") throw unavailable();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) throw new DpapiError("unprotect_failed", "The agent's store holds a secret that is not in the expected form; set it up again.");
      const base64 = await run(UNPROTECT_SCRIPT, blob, "unprotect_failed", spawner, env);
      return Buffer.from(base64, "base64").toString("utf8");
    },
  };
}

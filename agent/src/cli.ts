import path from "node:path";
import { EnrollmentCodeSchema } from "@satisfactory-dash/shared";
import { runAgent } from "./agentRunner.js";
import { BackendClient, BackendError } from "./backendClient.js";
import type { FetchLike } from "./backendClient.js";
import { DpapiError } from "./dpapi.js";
import type { Dpapi } from "./dpapi.js";
import { connectToGame } from "./gameReader.js";
import type { GameConnectionInput } from "./gameReader.js";
import { createFileLogger } from "./logger.js";
import { PromptAborted } from "./prompt.js";
import { failureCode } from "./sampler.js";
import type { GameReader } from "./sampler.js";
import { AgentStore, DEFAULT_GAME, SECRET_NAMES, StoreError, resolveDataDir } from "./store.js";
import type { SecretName } from "./store.js";
import { AGENT_VERSION } from "./version.js";

/**
 * The agent's command line (ADR-0031 PR 6). Commands, in the order a first setup needs them (the runbook explains why):
 *   agent set-tokens [--host H] [--api-port N] [--frm-port N]   the game's tokens, typed at a HIDDEN prompt, stored with DPAPI
 *   agent check                                                 read the game once over loopback and say what works
 *   agent enroll <CODE> --url <https://backend> [--replace]     trade the one-time code for the agent's credential
 *   agent run                                                   push snapshots and run commands until stopped
 *   agent status                                                what is set up (never a secret) and whether the store opens
 *   agent forget-credential                                     drop the agent's credential (before enrolling again)
 * Tokens are NEVER accepted as arguments or environment variables: command lines and environments are visible to other
 * processes and to process-audit logs. Exit codes: 0 ok, 1 failed or wrong usage, 2 the backend rejected the credential
 * (enrol again), 3 the store cannot be opened or unprotected (wrong Windows user or logon type).
 */

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_CREDENTIAL_REJECTED = 2;
export const EXIT_STORE = 3;

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  dpapi: Dpapi;
  /** A hidden prompt: the answer is never echoed. */
  prompt: (question: string) => Promise<string>;
  fetch?: FetchLike;
  connect?: (input: GameConnectionInput) => GameReader;
  runAgent?: typeof runAgent;
  /** Ends `run` (SIGINT/SIGTERM). */
  signal: AbortSignal;
}

const USAGE = `satisfactory-dash agent ${AGENT_VERSION}

Usage:
  agent set-tokens [--host <address>] [--api-port <n>] [--frm-port <n>]
  agent check
  agent enroll <CODE> --url <https://backend.example.com> [--replace]
  agent run
  agent status
  agent forget-credential
  agent --version

First setup, in this order: set-tokens, check, enroll, run. (Enrolling makes the dashboard forget any game token it
stored itself, so make sure the check passes first.) Tokens are typed at a hidden prompt, never passed as arguments.`;

type FlagKinds = Record<string, "value" | "boolean">;

class UsageError extends Error {}

/** A tiny argument parser: known flags only, and a flag that looks like a secret is refused with the reason. */
function parseArgs(argv: string[], flags: FlagKinds): { values: Record<string, string>; booleans: Set<string>; positionals: string[] } {
  const values: Record<string, string> = {};
  const booleans = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (/token|secret|password|key/i.test(name)) {
      throw new UsageError("Tokens and secrets are never accepted on the command line (other processes and audit logs can see it). The agent asks for them at a hidden prompt: run `agent set-tokens`.");
    }
    const kind = flags[name];
    if (kind === undefined) throw new UsageError(`Unknown option --${name}.`);
    if (kind === "boolean") {
      booleans.add(name);
    } else {
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`Option --${name} needs a value.`);
      values[name] = value;
    }
  }
  return { values, booleans, positionals };
}

function port(text: string | undefined, name: string, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new UsageError(`--${name} must be a port number from 1 to 65535.`);
  return value;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        deps.out(USAGE);
        return command === undefined ? EXIT_FAILED : EXIT_OK;
      case "--version":
      case "-v":
        deps.out(AGENT_VERSION);
        return EXIT_OK;
      case "set-tokens":
        return await setTokens(rest, deps);
      case "check":
        return await check(rest, deps);
      case "enroll":
        return await enroll(rest, deps);
      case "run":
        return await run(rest, deps);
      case "status":
        return await status(rest, deps);
      case "forget-credential":
        return await forgetCredential(rest, deps);
      default:
        deps.err(`Unknown command "${command.slice(0, 40)}".\n\n${USAGE}`);
        return EXIT_FAILED;
    }
  } catch (err) {
    return reportFailure(err, deps);
  }
}

/** One place turns an error into a message and an exit code, and only ever says what is safe to say. */
function reportFailure(err: unknown, deps: CliDeps): number {
  if (err instanceof UsageError) {
    deps.err(err.message);
    return EXIT_FAILED;
  }
  if (err instanceof PromptAborted) {
    deps.err("Cancelled. Nothing was saved.");
    return EXIT_FAILED;
  }
  if (err instanceof DpapiError || err instanceof StoreError) {
    deps.err(err.message);
    return EXIT_STORE;
  }
  if (err instanceof BackendError) {
    deps.err(err.message);
    return err.kind === "auth_rejected" ? EXIT_CREDENTIAL_REJECTED : EXIT_FAILED;
  }
  deps.err("The agent hit an unexpected problem and stopped.");
  return EXIT_FAILED;
}

const openStore = (deps: CliDeps) => AgentStore.open(resolveDataDir(deps.env), deps.dpapi);

async function setTokens(argv: string[], deps: CliDeps): Promise<number> {
  const { values } = parseArgs(argv, { host: "value", "api-port": "value", "frm-port": "value" });
  const store = openStore(deps);
  const current = store.game;
  const game = {
    host: values.host ?? current.host,
    apiPort: port(values["api-port"], "api-port", current.apiPort),
    frmPort: port(values["frm-port"], "frm-port", current.frmPort),
  };
  store.setGame(game); // refuses a host that is not this machine or its own network
  const apiToken = (await deps.prompt("Game API token (input hidden): ")).trim();
  if (apiToken === "") throw new UsageError("The game API token is required. Nothing was saved.");
  const frmToken = (await deps.prompt("FicsitRemoteMonitoring token (input hidden; press Enter if there is none): ")).trim();
  await store.setSecret("apiToken", apiToken);
  if (frmToken !== "") await store.setSecret("frmToken", frmToken);
  else store.clearSecret("frmToken");
  deps.out(`Saved. The game is at ${game.host} (API port ${game.apiPort}, FRM port ${game.frmPort}); the tokens are stored encrypted for this Windows user.`);
  deps.out("Next: agent check");
  return EXIT_OK;
}

async function gameInput(store: AgentStore): Promise<GameConnectionInput | undefined> {
  const apiToken = await store.getSecret("apiToken");
  if (apiToken === undefined) return undefined;
  const frmToken = await store.getSecret("frmToken");
  return { ...store.game, apiToken, ...(frmToken !== undefined ? { frmToken } : {}) };
}

async function check(argv: string[], deps: CliDeps): Promise<number> {
  parseArgs(argv, {});
  const store = openStore(deps);
  const input = await gameInput(store);
  if (input === undefined) throw new UsageError("The game's tokens are not set. Run `agent set-tokens` first.");
  const reader = (deps.connect ?? connectToGame)(input);
  deps.out(`Reading the game at ${input.host} (API port ${input.apiPort}, FRM port ${input.frmPort}) ...`);
  let problems = 0;
  const attempt = async (label: string, work: () => Promise<string>, required = true) => {
    try {
      deps.out(`  ${label.padEnd(11)} ok (${await work()})`);
    } catch (err) {
      // A code only: an error's message could carry an address or a token.
      deps.out(`  ${label.padEnd(11)} FAILED (${failureCode(err)})`);
      if (required) problems += 1;
    }
  };
  await attempt("status", async () => {
    const status = await reader.readStatus();
    return `${status.isGameRunning ? "game running" : "game not running"}, ${status.gamePaused ? "paused" : "not paused"}, tick ${status.tickHealth}`;
  });
  await attempt("power", async () => `${(await reader.readPower()).circuits.length} circuits`);
  await attempt("factory", async () => `${(await reader.readFactory()).buildings.length} machines`);
  const players = await reader.readPlayers().catch(() => undefined);
  deps.out(players === undefined ? "  players     FAILED" : players.available ? `  players     ok (${players.players.length} listed)` : "  players     not available (FicsitRemoteMonitoring is not answering; the dashboard falls back to counts)");
  await attempt("auto-pause", async () => ((await reader.readAutoPause()) ? "readable, on" : "readable, off"));
  if (problems > 0) {
    deps.out(`${problems} check(s) failed. Fix them before enrolling (see the runbook: is the game running, are the ports and tokens right?).`);
    return EXIT_FAILED;
  }
  deps.out("All good. Next: agent enroll <CODE> --url https://<your backend>   (get the code from the dashboard)");
  return EXIT_OK;
}

async function enroll(argv: string[], deps: CliDeps): Promise<number> {
  const { values, booleans, positionals } = parseArgs(argv, { url: "value", replace: "boolean" });
  const code = positionals[0]?.trim().toUpperCase();
  if (positionals.length !== 1 || code === undefined || !EnrollmentCodeSchema.safeParse(code).success) {
    throw new UsageError("Usage: agent enroll <CODE> --url <https://backend>. The code looks like AB3D-7XQ2 (from the dashboard, valid 10 minutes, one use).");
  }
  if (values.url === undefined) throw new UsageError("--url <https://backend> is required.");
  const store = openStore(deps);
  if (!store.hasSecret("apiToken")) {
    throw new UsageError("The game's tokens are not set. Run `agent set-tokens` and `agent check` first: enrolling makes the dashboard forget any game token it stored itself.");
  }
  if (store.hasSecret("agentSecret") && !booleans.has("replace")) {
    throw new UsageError("This agent already has a credential. To enrol it again (for example after the backend rejected it), add --replace.");
  }
  const client = new BackendClient({ baseUrl: values.url, fetch: deps.fetch });
  let response;
  try {
    response = await client.enroll(code);
  } catch (err) {
    if (err instanceof BackendError && err.code === "enrollment_code_invalid") {
      throw new UsageError("The backend did not accept that code: it may be wrong, already used or expired (codes last 10 minutes). Create a new one in the dashboard.");
    }
    throw err;
  }
  await store.setSecret("agentSecret", response.agentSecret);
  store.setBackend({ backendUrl: new URL(values.url.trim()).origin, serverId: response.serverId });
  deps.out(`Enrolled for server "${response.serverId}". The credential is stored encrypted for this Windows user (it is never shown again).`);
  deps.out("Next: agent run   (see the runbook to keep it running as a Scheduled Task)");
  return EXIT_OK;
}

async function run(argv: string[], deps: CliDeps): Promise<number> {
  parseArgs(argv, {});
  const dir = resolveDataDir(deps.env);
  const store = AgentStore.open(dir, deps.dpapi);
  if (store.backendUrl === undefined || store.serverId === undefined || !store.hasSecret("agentSecret")) {
    throw new UsageError("This agent is not enrolled. Run `agent enroll <CODE> --url <https://backend>` first.");
  }
  // Fail loudly and early when the store cannot be opened (wrong Windows user or logon type), before anything starts.
  const secrets = new Map<SecretName, string>();
  for (const name of SECRET_NAMES) {
    const value = await store.getSecret(name);
    if (value !== undefined) secrets.set(name, value);
  }
  const apiToken = secrets.get("apiToken");
  if (apiToken === undefined) throw new UsageError("The game's tokens are not set. Run `agent set-tokens` first.");
  const logger = createFileLogger({ dir: path.join(dir, "logs"), echo: deps.out });
  for (const secret of secrets.values()) logger.addSecret(secret);
  const reader = (deps.connect ?? connectToGame)({ ...store.game, apiToken, ...(secrets.has("frmToken") ? { frmToken: secrets.get("frmToken") } : {}) });
  const client = new BackendClient({ baseUrl: store.backendUrl, agentSecret: secrets.get("agentSecret"), fetch: deps.fetch });
  const outcome = await (deps.runAgent ?? runAgent)({ reader, client, logger, signal: deps.signal });
  if (outcome === "auth_rejected") {
    deps.err("The backend rejected this agent's credential, so the agent stopped and will not retry. It was probably revoked in the dashboard. Create a new enrolment code there, then run: agent enroll <CODE> --url <https://backend> --replace");
    return EXIT_CREDENTIAL_REJECTED;
  }
  return EXIT_OK;
}

async function status(argv: string[], deps: CliDeps): Promise<number> {
  parseArgs(argv, {});
  const dir = resolveDataDir(deps.env);
  const store = AgentStore.open(dir, deps.dpapi);
  const game = store.game;
  deps.out(`agent ${AGENT_VERSION}`);
  deps.out(`data folder:  ${dir}`);
  deps.out(`backend:      ${store.backendUrl ?? "not enrolled"}`);
  deps.out(`server:       ${store.serverId ?? "not enrolled"}`);
  deps.out(`game:         ${game.host} (API port ${game.apiPort}, FRM port ${game.frmPort})${game.host === DEFAULT_GAME.host ? "" : " [changed from the default]"}`);
  let unreadable = false;
  for (const name of SECRET_NAMES) {
    if (!store.hasSecret(name)) {
      deps.out(`${`${name}:`.padEnd(13)} not set`);
      continue;
    }
    try {
      await store.getSecret(name);
      deps.out(`${`${name}:`.padEnd(13)} stored, readable by this user`);
    } catch (err) {
      unreadable = true;
      deps.out(`${`${name}:`.padEnd(13)} stored, but CANNOT be unprotected: ${err instanceof DpapiError ? err.message : "unknown problem"}`);
    }
  }
  return unreadable ? EXIT_STORE : EXIT_OK;
}

async function forgetCredential(argv: string[], deps: CliDeps): Promise<number> {
  parseArgs(argv, {});
  const store = openStore(deps);
  store.clearSecret("agentSecret");
  deps.out("The agent's credential was removed. Enrol again with `agent enroll <CODE> --url <https://backend>`.");
  return EXIT_OK;
}

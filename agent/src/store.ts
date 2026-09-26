import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isIPv6 } from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Dpapi } from "./dpapi.js";

/**
 * The agent's own state on disk (ADR-0031 PR 6): where the backend is, which server this agent reports for, how to reach
 * the game over loopback, and the three secrets. Every secret is stored ONLY as a DPAPI blob for the current Windows user
 * (the agent's credential, the game's API token, the FRM token); nothing secret is ever written in the clear, and a
 * secret that cannot be unprotected is an error that says why, never an empty value. The file is written atomically.
 */

export const SECRET_NAMES = ["agentSecret", "apiToken", "frmToken"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const Base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** Where the game listens, from the agent's point of view. Loopback by default: the agent runs beside the game. */
export const DEFAULT_GAME = { host: "127.0.0.1", apiPort: 7777, frmPort: 8080 } as const;

const StoreFileSchema = z.object({
  version: z.literal(1),
  /** Where the backend is (https; http only for localhost during development). Not a secret. */
  backendUrl: z.string().max(2048).optional(),
  /** The public id of the server this agent reports for, from the enrolment answer. Not a secret. */
  serverId: z.string().max(200).optional(),
  game: z.object({ host: z.string().max(253), apiPort: z.number().int().min(1).max(65535), frmPort: z.number().int().min(1).max(65535) }).default({ ...DEFAULT_GAME }),
  secrets: z.object({ agentSecret: Base64Schema.optional(), apiToken: Base64Schema.optional(), frmToken: Base64Schema.optional() }).default({}),
});
export type StoreFile = z.infer<typeof StoreFileSchema>;

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/** Where the agent keeps its files: SD_AGENT_HOME, else the user's local app data, else the home folder. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const explicit = env.SD_AGENT_HOME;
  if (explicit !== undefined && explicit !== "") return path.resolve(explicit);
  const local = env.LOCALAPPDATA;
  if (local !== undefined && local !== "") return path.join(local, "satisfactory-dash-agent");
  return path.join(home, ".satisfactory-dash-agent");
}

/**
 * The game is reached with a secret (the API token), so the agent only talks to a game on THIS machine or its own network:
 * a loopback name, or an IP literal that is loopback, private or link-local. Anything else (a public host, a name that
 * could resolve anywhere) is refused, so a typo cannot send the token across the internet.
 */
export function isAllowedGameHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value === "localhost") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((part) => part > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  // A REAL IPv6 literal, not a prefix: "fd00:@evil.com" starts like a private address but is a URL with another host in it.
  const bare = value.replace(/^\[|\]$/g, "");
  if (!isIPv6(bare)) return false;
  return bare === "::1" || /^f[cd][0-9a-f]{2}:/.test(bare) || bare.startsWith("fe80:");
}

export class AgentStore {
  private data: StoreFile;

  private constructor(
    private readonly dir: string,
    data: StoreFile,
    private readonly dpapi: Dpapi,
  ) {
    this.data = data;
  }

  /** Opens the store in `dir`; a missing file is a fresh, empty store. A file that is not the expected shape is an error. */
  static open(dir: string, dpapi: Dpapi): AgentStore {
    const file = path.join(dir, "store.json");
    if (!existsSync(file)) return new AgentStore(dir, StoreFileSchema.parse({ version: 1 }), dpapi);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new StoreError(`The agent's store file (${file}) is not valid JSON. Fix or delete it and set the agent up again.`);
    }
    const result = StoreFileSchema.safeParse(parsed);
    if (!result.success) throw new StoreError(`The agent's store file (${file}) is not in the expected form. Fix or delete it and set the agent up again.`);
    // The same rule as when it is set: a hand-edited file must not point the game token at a public host.
    if (!isAllowedGameHost(result.data.game.host)) {
      throw new StoreError(`The game host in the agent's store (${file}) is not this machine or an address on its own network. Run \`agent set-tokens --host 127.0.0.1\` again.`);
    }
    return new AgentStore(dir, result.data, dpapi);
  }

  /** Proves DPAPI works for this user (protect, then unprotect a probe) WITHOUT storing anything: used before a one-time code is spent. */
  async probe(): Promise<void> {
    const marker = "probe-value";
    if ((await this.dpapi.unprotect(await this.dpapi.protect(marker))) !== marker) throw new StoreError("Windows DPAPI did not return what was protected; the store cannot be trusted.");
  }

  get backendUrl(): string | undefined {
    return this.data.backendUrl;
  }
  get serverId(): string | undefined {
    return this.data.serverId;
  }
  get game(): StoreFile["game"] {
    return { ...this.data.game };
  }
  hasSecret(name: SecretName): boolean {
    return this.data.secrets[name] !== undefined;
  }

  /** Decrypts one secret; undefined when it was never set, a `DpapiError` when Windows cannot unprotect it. */
  async getSecret(name: SecretName): Promise<string | undefined> {
    const blob = this.data.secrets[name];
    return blob === undefined ? undefined : this.dpapi.unprotect(blob);
  }

  /** Encrypts and stores one secret (and saves). The plaintext is not kept. */
  async setSecret(name: SecretName, plaintext: string): Promise<void> {
    this.data.secrets = { ...this.data.secrets, [name]: await this.dpapi.protect(plaintext) };
    this.save();
  }

  clearSecret(name: SecretName): void {
    const { [name]: _removed, ...rest } = this.data.secrets;
    this.data.secrets = rest;
    this.save();
  }

  setBackend(fields: { backendUrl: string; serverId: string }): void {
    this.data = { ...this.data, ...fields };
    this.save();
  }

  setGame(game: StoreFile["game"]): void {
    if (!isAllowedGameHost(game.host)) {
      throw new StoreError("The game host must be this machine or an address on its own network (127.0.0.1, localhost, or a private IP), never a public one.");
    }
    this.data = { ...this.data, game: { ...game, host: game.host.trim() } };
    this.save();
  }

  /** Writes the file atomically (a temporary file, then a rename), so a crash never leaves half a store. */
  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, "store.json");
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, file);
    } catch (err) {
      try {
        unlinkSync(temporary); // no half-written copy of the store is left behind (an antivirus lock can fail the rename)
      } catch {
        // nothing to remove
      }
      throw err;
    }
  }
}

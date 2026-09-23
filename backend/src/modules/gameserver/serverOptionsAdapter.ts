import { z } from "zod";
import { UpstreamError } from "../../platform/errors.js";
import type { VanillaApiClientLike } from "./satisfactoryServerAdapter.js";

/**
 * ADR-0012 and the rule in this module's README: `GetServerOptions` output is a SECRET
 * (it contains FRM's uWS.AuthenticationToken in plaintext). This file is the only code
 * allowed to call it. It reads exactly one allowlisted key from ServerOptions and
 * PendingServerOptions, and everything else in the response is dropped here, never
 * returned, logged, stored or put in an error message.
 */
const AUTO_PAUSE_KEY = "FG.DSAutoPause";

/** Sent to the game server as-is: the allowlist for what the dashboard may change. */
const WRITABLE_OPTION_KEYS = [AUTO_PAUSE_KEY] as const;

/**
 * The response is validated loosely on purpose (`unknown` values), so a failure can only
 * ever mention a key's path, never a value. Field names are camelCase on the live server
 * (the docs' PascalCase is wrong for responses; checked live 2026-09-23, see
 * docs-vault/wiki/vanilla-dedicated-server-api.md).
 */
const RawServerOptionsSchema = z.object({
  serverOptions: z.record(z.string(), z.unknown()),
  pendingServerOptions: z.record(z.string(), z.unknown()),
});
/** The option's value is the string "True" or "False" (a stringified boolean). */
const RawBoolOptionSchema = z.string().regex(/^(true|false)$/i);

function invalidResponse(what: string): UpstreamError {
  // No `cause` and no raw value: the message names only the field.
  return new UpstreamError(`GetServerOptions response failed validation: ${what}`, {
    failureKind: "invalid_response",
  });
}

function toBoolean(value: unknown, where: string): boolean {
  const parsed = RawBoolOptionSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidResponse(`${where} is not "True" or "False"`);
  }
  return parsed.data.toLowerCase() === "true";
}

/** The privilege level (`pl`) inside a vanilla API token: Base64 JSON, then ".", then a
 *  hex fingerprint (docs-vault/raw-sources/dedicated-server-api.md, "Authentication").
 *  Only reads the claim; the server verifies the fingerprint (VerifyAuthenticationToken). */
function privilegeLevelOf(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64").toString("utf8")) as unknown;
    const pl = typeof payload === "object" && payload !== null ? (payload as { pl?: unknown }).pl : undefined;
    return typeof pl === "string" ? pl : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every call in this file goes through here. The shared vanilla client can attach a
 * `cause` (e.g. the JSON.parse SyntaxError for a truncated 2xx body, whose message may
 * quote a snippet of the body) and pass an upstream error's `errorData` along; either
 * could carry option values, so an UpstreamError is rebuilt with only its message,
 * kind, status and error code. (Security review of PR 6.)
 */
async function scrubbed<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof UpstreamError) {
      throw new UpstreamError(err.message, { failureKind: err.failureKind, status: err.status, errorCode: err.errorCode });
    }
    throw err;
  }
}

/** Token privilege levels that may change server options (dedicated-server-api.md:248-268).
 *  `APIToken` is an application token (`server.GenerateAPIToken`), which third-party
 *  apps are told to use (:279-284). Never InitialAdmin, Client or NotAuthenticated. */
const EDITING_PRIVILEGE_LEVELS = new Set(["Administrator", "APIToken"]);

export interface AutoPauseState {
  /** The applied FG.DSAutoPause value. */
  autoPause: boolean;
  /** The option also appears in PendingServerOptions (a change waiting for a restart). */
  pending: boolean;
}

/** What other modules depend on (ADR-0014): the only server-option operations the
 *  dashboard has, with nothing else from GetServerOptions reachable through it. */
export interface ServerOptionsPort {
  readAutoPause(): Promise<AutoPauseState>;
  applyAutoPause(enabled: boolean): Promise<void>;
  /** ADR-0012 `editable`: a token is configured AND the server accepts it AND its
   *  privilege level is Administrator or APIToken (an application token). A rejected
   *  token is `false`, not an error; an unreachable server still throws an UpstreamError. */
  canEditOptions(): Promise<boolean>;
}

export class ServerOptionsAdapter implements ServerOptionsPort {
  constructor(
    private readonly vanillaApi: VanillaApiClientLike,
    private readonly apiToken: string | undefined,
  ) {}

  async readAutoPause(): Promise<AutoPauseState> {
    const raw = await scrubbed(() => this.vanillaApi.call<unknown>("GetServerOptions"));
    const parsed = RawServerOptionsSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidResponse("the response is not { serverOptions, pendingServerOptions }");
    }
    const { serverOptions, pendingServerOptions } = parsed.data;
    if (!(AUTO_PAUSE_KEY in serverOptions)) {
      throw invalidResponse(`serverOptions has no ${AUTO_PAUSE_KEY}`);
    }
    return {
      autoPause: toBoolean(serverOptions[AUTO_PAUSE_KEY], `serverOptions.${AUTO_PAUSE_KEY}`),
      pending: AUTO_PAUSE_KEY in pendingServerOptions,
    };
  }

  async applyAutoPause(enabled: boolean): Promise<void> {
    // Request keys are PascalCase, as in the docs (dedicated-server-api.md:541-551);
    // verified live 2026-09-23: this shape returns 204 and applies immediately.
    const updated: Record<(typeof WRITABLE_OPTION_KEYS)[number], string> = { [AUTO_PAUSE_KEY]: enabled ? "True" : "False" };
    await scrubbed(() => this.vanillaApi.call("ApplyServerOptions", { UpdatedServerOptions: updated }));
  }

  async canEditOptions(): Promise<boolean> {
    const level = this.apiToken ? privilegeLevelOf(this.apiToken) : undefined;
    if (level === undefined || !EDITING_PRIVILEGE_LEVELS.has(level)) {
      return false;
    }
    try {
      await scrubbed(() => this.vanillaApi.call("VerifyAuthenticationToken"));
      return true;
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      throw err;
    }
  }
}

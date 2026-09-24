import { readFileSync } from "node:fs";
import { z } from "zod";
import { ServerIdSchema } from "@satisfactory-dash/shared";
import { ConfigError } from "../../platform/errors.js";
import { loadSatisfactoryServerConfigFromEnv } from "./connectionConfig.js";
import type { SatisfactoryServerConfig } from "./connectionConfig.js";

/**
 * ADR-0025 PR 1: several game servers from one git-ignored JSON file named by
 * SATISFACTORY_SERVERS_FILE (the same protection as .env, since it holds tokens). Each entry
 * names a server and how to reach it; the rest of the backend sees only the public id and
 * display name. Absent the variable, the single-server SATISFACTORY_* env still works.
 *
 * Every value is validated by the same rules as the env config (ports 1-65535, the FRM
 * loopback/private-host rule, the timeout range): an entry is turned into the env-shaped
 * record that loadSatisfactoryServerConfigFromEnv reads, so the two paths cannot drift apart.
 */
const IntegerSchema = z.number().int();

const ServerFileEntrySchema = z.strictObject({
  id: ServerIdSchema,
  /** Shown to users by GET /api/servers. Never a host or port. */
  name: z.string().trim().min(1).max(64).optional(),
  host: z.string().trim().min(1).optional(),
  apiPort: IntegerSchema.optional(),
  apiToken: z.string().optional(),
  frmPort: IntegerSchema.optional(),
  frmToken: z.string().optional(),
  requestTimeoutMs: IntegerSchema.optional(),
  /** true = verify the game server's TLS certificate even on a loopback/private host. */
  verifyApiCertificate: z.boolean().optional(),
});

const ServersFileSchema = z
  .strictObject({ servers: z.array(ServerFileEntrySchema).min(1).max(32) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.servers.forEach((server, index) => {
      if (seen.has(server.id)) {
        ctx.addIssue({ code: "custom", path: ["servers", index, "id"], message: `duplicate server id "${server.id}"` });
      }
      seen.add(server.id);
    });
  });

type ServerFileEntry = z.infer<typeof ServerFileEntrySchema>;

export interface ConfiguredServer {
  id: string;
  displayName: string;
  config: SatisfactoryServerConfig;
}

const DEFAULT_DISPLAY_NAME = "Satisfactory server";

function envFor(entry: ServerFileEntry): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const set = (name: string, value: string | number | undefined) => {
    if (value !== undefined) {
      env[name] = String(value);
    }
  };
  set("SATISFACTORY_SERVER_HOST", entry.host);
  set("SATISFACTORY_API_PORT", entry.apiPort);
  set("SATISFACTORY_API_TOKEN", entry.apiToken);
  set("FRM_WEB_PORT", entry.frmPort);
  set("FRM_AUTH_TOKEN", entry.frmToken);
  set("SATISFACTORY_REQUEST_TIMEOUT_MS", entry.requestTimeoutMs);
  if (entry.verifyApiCertificate !== undefined) {
    set("SATISFACTORY_API_REJECT_UNAUTHORIZED", entry.verifyApiCertificate ? "true" : "false");
  }
  return env;
}

/** The single-server variables a servers file replaces (ADR-0025 PR 1). */
const SINGLE_SERVER_ENV_NAMES = [
  "SATISFACTORY_SERVER_ID",
  "SATISFACTORY_SERVER_NAME",
  "SATISFACTORY_SERVER_HOST",
  "SATISFACTORY_API_PORT",
  "SATISFACTORY_API_TOKEN",
  "SATISFACTORY_API_REJECT_UNAUTHORIZED",
  "FRM_WEB_PORT",
  "FRM_AUTH_TOKEN",
  "SATISFACTORY_REQUEST_TIMEOUT_MS",
] as const;

/**
 * Names (never values) of the single-server variables that are set but ignored because a
 * servers file is in use, so a half-migrated .env is not confusing. Empty when no file is set.
 */
export function ignoredSingleServerEnvNames(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!env.SATISFACTORY_SERVERS_FILE?.trim()) {
    return [];
  }
  return SINGLE_SERVER_ENV_NAMES.filter((name) => (env[name] ?? "").trim() !== "");
}

/** Field names as the file spells them, for messages from the shared env validators. */
const FILE_FIELD_FOR_ENV_NAME: Record<string, string> = {
  SATISFACTORY_SERVER_HOST: "host",
  SATISFACTORY_API_PORT: "apiPort",
  FRM_WEB_PORT: "frmPort",
  SATISFACTORY_REQUEST_TIMEOUT_MS: "requestTimeoutMs",
};

function inFileTerms(message: string): string {
  return message.replace(/\b(SATISFACTORY_SERVER_HOST|SATISFACTORY_API_PORT|FRM_WEB_PORT|SATISFACTORY_REQUEST_TIMEOUT_MS)\b/g, (name) => FILE_FIELD_FOR_ENV_NAME[name]);
}

/**
 * The servers named by SATISFACTORY_SERVERS_FILE, or undefined when the variable is unset or
 * blank (the caller then uses the single-server env). Throws ConfigError, so the backend
 * refuses to start, on an unreadable or malformed file. Messages name the field and the
 * server id, never a value (a token may be nearby).
 */
export function loadConfiguredServersFromFile(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ConfiguredServer[] | undefined {
  const file = env.SATISFACTORY_SERVERS_FILE?.trim();
  if (!file) {
    return undefined;
  }
  let text: string;
  try {
    text = readFile(file);
  } catch {
    throw new ConfigError("SATISFACTORY_SERVERS_FILE names a file that can't be read (does it exist?).");
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new ConfigError("The servers file is not valid JSON.");
  }
  const parsed = ServersFileSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`);
    throw new ConfigError(`The servers file is invalid: ${problems.slice(0, 5).join("; ")}`);
  }
  return parsed.data.servers.map((entry) => {
    try {
      return {
        id: entry.id,
        displayName: entry.name ?? DEFAULT_DISPLAY_NAME,
        config: loadSatisfactoryServerConfigFromEnv(envFor(entry)),
      };
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new ConfigError(`Servers file, server "${entry.id}": ${inFileTerms(err.message)}`);
      }
      throw err;
    }
  });
}

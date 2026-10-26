import type { CompatResponse } from "@satisfactory-dash/shared";
import { isOlder, versionInRange } from "./version";

/** What a server runs to report: the SML mod in the game, or the Windows agent beside it. */
export type ClientKind = "mod" | "agent";

export interface ReportedClient {
  kind: ClientKind;
  /** The version without the mod's `mod/` prefix. */
  version: string;
}

/**
 * The mod reports `mod/x.y.z` and the agent a bare version (ADR-0039 Decision 2, ADR-0042), so the kind comes from
 * what the backend already stores in `agentVersion`; no contract field is needed. `null` when nothing was reported.
 */
export function clientOf(agentVersion: string | null | undefined): ReportedClient | null {
  if (agentVersion === null || agentVersion === undefined || agentVersion === "") return null;
  if (agentVersion.startsWith("mod/")) return { kind: "mod", version: agentVersion.slice(4) };
  return { kind: "agent", version: agentVersion };
}

export interface SecurityNotice {
  /** The advisory's id, or null when the version is only below `minSafe`. */
  id: string | null;
  fixed: string;
  /** Plain text from the backend, or null. */
  summary: string | null;
}

export interface UpdateNotices {
  kind: ClientKind;
  version: string;
  current: string;
  /** Advisories the version falls in; if none but it is below `minSafe`, one generic entry. Not dismissible. */
  security: SecurityNotice[];
  /** Older than `minSupported`. */
  unsupported: boolean;
  minSupported: string;
  /** Older than `current`. */
  updateAvailable: boolean;
}

/**
 * Compares one server's reported version with the policy. `null` (show nothing) when nothing was reported, the policy
 * is not loaded, or the reported version is malformed: a version this page cannot read is never a false alarm.
 */
export function updateNotices(agentVersion: string | null | undefined, compat: CompatResponse | undefined): UpdateNotices | null {
  const client = clientOf(agentVersion);
  if (client === null || compat === undefined) return null;
  const policy = compat[client.kind];
  const version = client.version;
  // A malformed version compares as neither older nor in any range, so every flag below stays off.
  const security: SecurityNotice[] = policy.advisories
    .filter((a) => versionInRange(version, a.affected))
    .map((a) => ({ id: a.id, fixed: a.fixed, summary: a.summary }));
  if (security.length === 0 && isOlder(version, policy.minSafe)) {
    security.push({ id: null, fixed: policy.minSafe, summary: null });
  }
  const unsupported = isOlder(version, policy.minSupported);
  const updateAvailable = isOlder(version, policy.current);
  if (security.length === 0 && !unsupported && !updateAvailable) return null;
  return { kind: client.kind, version, current: policy.current, security, unsupported, minSupported: policy.minSupported, updateAvailable };
}

/** The most important thing a server's versions say, for the one-line summary. */
export function severityOf(notices: UpdateNotices): "security" | "unsupported" | "update" {
  if (notices.security.length > 0) return "security";
  return notices.unsupported ? "unsupported" : "update";
}

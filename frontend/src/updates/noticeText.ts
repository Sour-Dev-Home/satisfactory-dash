import { REPO_URL } from "../source";
import type { ClientKind, SecurityNotice, UpdateNotices } from "./notices";

/** The agent's install and update steps (docs-vault/wiki/runbooks/agent-app.md). The mod has no page of ours: ficsit.app is its home. */
export const AGENT_RUNBOOK_URL = `${REPO_URL}/blob/main/docs-vault/wiki/runbooks/agent-app.md`;

export const componentName = (kind: ClientKind): string => (kind === "mod" ? "the Satisfactory Dash mod" : "the game PC agent");

/** Says what an update does and does not do. The dashboard never pushes one (ADR-0057 Decision 7). */
export const applyText = (kind: ClientKind): string =>
  kind === "mod"
    ? "Update it in Satisfactory Mod Manager (ficsit.app); it applies at the next server restart."
    : "Update it on the game PC and restart the agent only; the game server keeps running.";

/** Where the install steps are, as link text. The mod has none here, so its wording points to ficsit.app. */
export const installLink = (kind: ClientKind): { href: string; label: string } | null =>
  kind === "agent" ? { href: AGENT_RUNBOOK_URL, label: "Install steps" } : null;

export function updateText(n: UpdateNotices): string {
  return `Update available: ${componentName(n.kind)} is ${n.version}, the newest is ${n.current}. ${applyText(n.kind)}`;
}

export function unsupportedText(n: UpdateNotices): string {
  return (
    `Unsupported version: ${componentName(n.kind)} ${n.version} is older than ${n.minSupported}, the oldest the dashboard fully supports. ` +
    `Some features may be reduced or missing. Update to ${n.current}. ${applyText(n.kind)}`
  );
}

export function securityText(n: UpdateNotices, s: SecurityNotice): string {
  const what = s.summary ?? "This version has a known security problem.";
  const id = s.id === null ? "" : ` (${s.id})`;
  return `Security advisory${id}: ${what} ${componentName(n.kind)} is ${n.version}; update to ${s.fixed} or newer. ${applyText(n.kind)}`;
}

import type { TestConnectionResponse } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";

/** ADR-0030 amendment 1, in plain words (the envelope's own message cites the ADR). */
export const LOOPBACK_ONLY = "Only servers on this machine can be added for now.";

/** The management codes whose envelope message says what to do (import first, id taken, ...). */
const SAY_THE_MESSAGE = new Set([
  "import_required",
  "address_not_allowed",
  "connection_test_failed",
  "connection_unreadable",
  "server_exists",
  "server_limit_reached",
]);

/**
 * The text for a failed save or test, or undefined to fall back to ErrorNotice (network, 403,
 * contract drift...). The envelope message is safe to show (ADR-0003) and never names an address.
 */
export function managementErrorText(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === "lan_requires_cert_pinning") return LOOPBACK_ONLY;
  return SAY_THE_MESSAGE.has(error.code) ? error.message : undefined;
}

const CHECK_TEXT: Record<NonNullable<TestConnectionResponse["api"]["error"]>, string> = {
  unreachable: "didn't answer (not running, wrong port, or a firewall)",
  unauthorized: "rejected the token",
  invalid_response: "answered, but not like the game server (is something else on that port?)",
};

/** One line per check: "Game API: OK" / "FRM: didn't answer (...)". */
export function checkLines(result: TestConnectionResponse): { label: string; ok: boolean; text: string }[] {
  return [
    { label: "Game API", check: result.api },
    { label: "FicsitRemoteMonitoring", check: result.frm },
  ].map(({ label, check }) => ({
    label,
    ok: check.ok,
    text: check.ok ? "OK" : check.error ? CHECK_TEXT[check.error] : "failed",
  }));
}

import { describe, expect, it } from "vitest";
import { commandExpired, commandFailed, commandPending, commandSent, commandSucceeded } from "@satisfactory-dash/shared/fixtures";
import { commandPhase, EXPIRY_GRACE_MS, failureText, msUntilGiveUp } from "./command";

describe("commandPhase", () => {
  it("maps each final status, and counts anything else as still on its way", () => {
    expect(commandPhase(commandSucceeded.command.status)).toBe("succeeded");
    expect(commandPhase(commandFailed.command.status)).toBe("failed");
    expect(commandPhase(commandExpired.command.status)).toBe("expired");
    expect(commandPhase(commandPending.command.status)).toBe("waiting");
    expect(commandPhase(commandSent.command.status)).toBe("waiting");
    expect(commandPhase("queued_at_agent")).toBe("waiting");
  });
});

describe("msUntilGiveUp", () => {
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  const at = (iso: string) => ({ expiresAt: iso });

  it("waits until just past the expiry", () => {
    expect(msUntilGiveUp(at("2026-09-26T12:10:00.000Z"), now)).toBe(600_000 + EXPIRY_GRACE_MS);
  });

  it("is 0, not negative, once the expiry and its grace have passed", () => {
    expect(msUntilGiveUp(at("2026-09-26T11:00:00.000Z"), now)).toBe(0);
  });

  it("never exceeds what setTimeout can wait, so a far-off expiry doesn't give up at once", () => {
    expect(msUntilGiveUp(at("2099-01-01T00:00:00.000Z"), now)).toBe(2 ** 31 - 1);
  });
});

describe("failureText", () => {
  it("names each known result code, and falls back for an unknown or missing one", () => {
    expect(failureText("unsupported")).toMatch(/Update the agent/);
    expect(failureText("upstream_auth_rejected")).toMatch(/admin token/);
    expect(failureText("upstream_error")).toMatch(/reported an error/);
    expect(failureText("disk_on_fire")).toBe("The change failed on the game PC; the setting didn't change.");
    expect(failureText(null)).toBe("The change failed on the game PC; the setting didn't change.");
  });
});

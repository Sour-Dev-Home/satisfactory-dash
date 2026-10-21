import { describe, expect, it } from "vitest";
import { serversSelfServe } from "@satisfactory-dash/shared/fixtures";
import { ApiError } from "../api/errors";
import { errorLastOwner, errorOperatorAccount, errorOperatorServers, errorReauthRequired } from "../test/accountMocks";
import { canLeave, deleteRefusal, isLastOwner, roleText, serversRemovedWithAccount } from "./accountText";

const apiError = (status: number, body: { error: ConstructorParameters<typeof ApiError>[1] }) => new ApiError(status, body.error);

describe("account text and rules (ADR-0047)", () => {
  it("names only the self-serve servers the account owns as removed with it", () => {
    expect(serversRemovedWithAccount(serversSelfServe.servers)).toEqual(
      serversSelfServe.servers.filter((s) => s.role === "owner" && s.createdVia === "self_serve").map((s) => s.displayName),
    );
    expect(serversRemovedWithAccount([{ id: "a", displayName: "A", role: "owner", createdVia: "operator" }])).toEqual([]);
    expect(serversRemovedWithAccount([{ id: "a", displayName: "A", role: "admin", createdVia: "self_serve" }])).toEqual([]);
  });

  it("lets anyone with a role but the owner leave", () => {
    expect(canLeave({ id: "a", displayName: "A", role: "viewer" })).toBe(true);
    expect(canLeave({ id: "a", displayName: "A", role: "admin" })).toBe(true);
    expect(canLeave({ id: "a", displayName: "A", role: "moderator" })).toBe(true);
    expect(canLeave({ id: "a", displayName: "A", role: "owner" })).toBe(false);
    expect(canLeave({ id: "a", displayName: "A" })).toBe(false);
  });

  it("says an unknown role as 'member'", () => {
    expect(roleText("viewer")).toBe("viewer");
    expect(roleText("admin")).toBe("admin");
    expect(roleText("moderator")).toBe("member");
  });

  it("tells the deletion refusals apart by code and reason", () => {
    expect(deleteRefusal(apiError(403, errorReauthRequired))).toEqual({ kind: "reauth" });
    expect(deleteRefusal(apiError(409, errorOperatorServers))).toEqual({
      kind: "operator_servers",
      servers: ["Satisfactory server", "Creative test world"],
    });
    expect(deleteRefusal(apiError(403, errorOperatorAccount))).toEqual({ kind: "operator_account" });
    // A plain forbidden, an unknown reason, a would_orphan for another cause: worded generically.
    expect(deleteRefusal(new ApiError(403, { code: "forbidden", message: "m", requestId: "r" }))).toEqual({ kind: "other" });
    expect(deleteRefusal(new ApiError(409, { code: "would_orphan", reason: "later", message: "m", requestId: "r" }))).toEqual({ kind: "other" });
    expect(deleteRefusal(apiError(409, errorLastOwner))).toEqual({ kind: "other" });
    expect(deleteRefusal(new Error("boom"))).toEqual({ kind: "other" });
  });

  it("lists no server when an operator_servers refusal carries none", () => {
    const body = { ...errorOperatorServers.error, servers: undefined };
    expect(deleteRefusal(new ApiError(409, body))).toEqual({ kind: "operator_servers", servers: [] });
  });

  it("recognises the owner's refusal to leave", () => {
    expect(isLastOwner(apiError(409, errorLastOwner))).toBe(true);
    expect(isLastOwner(apiError(409, errorOperatorServers))).toBe(false);
    expect(isLastOwner(new Error("x"))).toBe(false);
  });
});

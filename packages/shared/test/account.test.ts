import { describe, expect, it } from "vitest";
import {
  AccountForbiddenReason,
  ApiErrorResponseSchema,
  DeleteAccountResponseSchema,
  KnownErrorCode,
  LeaveServerResponseSchema,
  WouldOrphanReason,
  endpoints,
} from "../src";

// ADR-0047: account deletion and leaving a server.
describe("the account deletion and leave endpoints", () => {
  it("deletes the account at DELETE /api/account, with no body", () => {
    expect(endpoints.account.remove).toMatchObject({ method: "DELETE", route: "/api/account" });
    expect(endpoints.account.remove.path()).toBe("/api/account");
    expect("request" in endpoints.account.remove).toBe(false);
    expect("operatorOnly" in endpoints.account.remove).toBe(false);
  });

  it("leaves a server at POST .../members/me/leave, server-scoped, with no body, open to any member", () => {
    expect(endpoints.members.leave).toMatchObject({ method: "POST", route: "/api/servers/:serverId/members/me/leave" });
    expect(endpoints.members.leave.path("a b")).toBe("/api/servers/a%20b/members/me/leave");
    expect("request" in endpoints.members.leave).toBe(false);
    expect(endpoints.members.leave.memberSelfService).toBe(true);
    expect("operatorOnly" in endpoints.members.leave).toBe(false);
  });

  it("answers { deleted: true } and { left: true } only", () => {
    expect(DeleteAccountResponseSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(DeleteAccountResponseSchema.safeParse({ deleted: false }).success).toBe(false);
    expect(LeaveServerResponseSchema.parse({ left: true })).toEqual({ left: true });
    expect(LeaveServerResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("the ADR-0047 error codes", () => {
  it("are known codes, additive to the existing ones", () => {
    expect(KnownErrorCode.options).toEqual(expect.arrayContaining(["would_orphan", "reauth_required", "forbidden"]));
  });

  it("name their reasons", () => {
    expect(WouldOrphanReason.options).toEqual(["last_owner", "operator_servers"]);
    expect(AccountForbiddenReason.options).toEqual(["operator_account"]);
  });

  const base = { code: "would_orphan", message: "Hand these servers over first", requestId: "req-1", reason: "operator_servers" };

  it("lets a would_orphan envelope carry the blocking servers (id and display name)", () => {
    const parsed = ApiErrorResponseSchema.parse({ error: { ...base, servers: [{ id: "alpha", displayName: "Alpha" }] } });
    expect(parsed.error.servers).toEqual([{ id: "alpha", displayName: "Alpha" }]);
  });

  it("keeps `servers` optional, so an envelope without it (every other error) still parses", () => {
    expect(ApiErrorResponseSchema.parse({ error: { ...base, reason: "last_owner" } }).error.servers).toBeUndefined();
  });

  it("refuses a malformed server in the list", () => {
    expect(ApiErrorResponseSchema.safeParse({ error: { ...base, servers: [{ id: "Bad_Id", displayName: "X" }] } }).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({ error: { ...base, servers: [{ id: "alpha" }] } }).success).toBe(false);
  });
});

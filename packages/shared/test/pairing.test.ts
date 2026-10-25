import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  CompatRangeSchema,
  CompatResponseSchema,
  CompatVersionSchema,
  EnrollResponseSchema,
  EnrollmentCodeSchema,
  KNOWN_PAIRING_POLL_STATUSES,
  PAIRING_EXPIRES_IN_SECONDS,
  PAIRING_POLL_INTERVAL_SECONDS,
  PairingApproveRequestSchema,
  PairingLookupRequestSchema,
  PairingLookupResponseSchema,
  PairingPollRequestSchema,
  PairingPollResponseSchema,
  PairingSecretSchema,
  PairingStartRequestSchema,
  PairingStartResponseSchema,
  endpoints,
} from "../src/index";

describe("pairing: start", () => {
  it("accepts the version alone, or with a bounded name", () => {
    expect(PairingStartRequestSchema.safeParse(fixtures.pairingStartRequest).success).toBe(true);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0" }).success).toBe(true);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0", serverName: "x".repeat(200) }).success).toBe(true);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0", serverName: "x".repeat(201) }).success).toBe(false);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0", serverName: "" }).success).toBe(false);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "v".repeat(33) }).success).toBe(false);
    expect(PairingStartRequestSchema.safeParse({ serverName: "x" }).success).toBe(false);
  });

  it("is strict: no machine detail, and no secret or code can be smuggled in", () => {
    for (const extra of [{ hostname: "pc" }, { pairingSecret: fixtures.pairingStartResponse.pairingSecret }, { userCode: "AB3D-7XQ2-K5MN" }]) {
      expect(PairingStartRequestSchema.safeParse({ ...fixtures.pairingStartRequest, ...extra }).success).toBe(false);
    }
  });

  it("answers a 128-bit base64url secret, the unchanged 60-bit user code, 900 s and 5 s", () => {
    const r = PairingStartResponseSchema.parse(fixtures.pairingStartResponse);
    expect(r.pairingSecret).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(EnrollmentCodeSchema.safeParse(r.userCode).success).toBe(true);
    expect([r.expiresIn, r.interval]).toEqual([PAIRING_EXPIRES_IN_SECONDS, PAIRING_POLL_INTERVAL_SECONDS]);
    expect([PAIRING_EXPIRES_IN_SECONDS, PAIRING_POLL_INTERVAL_SECONDS]).toEqual([900, 5]);
    expect(PairingStartResponseSchema.safeParse({ ...r, userCode: "ab3d-7xq2-k5mn" }).success).toBe(false);
    expect(PairingStartResponseSchema.safeParse({ ...r, pairingSecret: "short" }).success).toBe(false);
  });

  it("is registered unauthenticated under /agent/v1, next to enrol", () => {
    expect(endpoints.agentApi.startPairing).toMatchObject({ method: "POST", route: "/agent/v1/pairings" });
    expect(endpoints.agentApi.startPairing.path()).toBe("/agent/v1/pairings");
    expect(endpoints.agentApi.pollPairing).toMatchObject({ method: "POST", route: "/agent/v1/pairings/poll" });
  });
});

describe("pairing: secret", () => {
  it("is exactly 22 base64url characters", () => {
    for (const ok of ["c2VjcmV0LXBhaXJpbmctMT","A".repeat(22), "-_".repeat(11)]) expect(PairingSecretSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "A".repeat(21), "A".repeat(23), "A".repeat(43), "A".repeat(21) + "=", "A".repeat(21) + "+", "A".repeat(21) + "/", " " + "A".repeat(21), "A".repeat(22) + "\n"]) {
      expect(PairingSecretSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("travels only in the poll body: the path takes no argument, and the dashboard side never carries it", () => {
    expect(endpoints.agentApi.pollPairing.path()).not.toMatch(/[?:]/);
    expect(endpoints.agentApi.pollPairing.path.length).toBe(0);
    expect(PairingPollRequestSchema.safeParse(fixtures.pairingPollRequest).success).toBe(true);
    expect(PairingLookupRequestSchema.safeParse({ userCode: "AB3D-7XQ2-K5MN", pairingSecret: fixtures.pairingStartResponse.pairingSecret }).success).toBe(false);
    expect(PairingApproveRequestSchema.safeParse({ ...fixtures.pairingApproveRequestNew, pairingSecret: fixtures.pairingStartResponse.pairingSecret }).success).toBe(false);
  });

  it("the poll request is strict, and a user code is not a secret", () => {
    expect(PairingPollRequestSchema.safeParse({}).success).toBe(false);
    expect(PairingPollRequestSchema.safeParse({ pairingSecret: "AB3D-7XQ2-K5MN" }).success).toBe(false);
    expect(PairingPollRequestSchema.safeParse({ ...fixtures.pairingPollRequest, userCode: "AB3D-7XQ2-K5MN" }).success).toBe(false);
  });
});

describe("pairing: poll answers", () => {
  it("lists the four stable codes and parses each fixture", () => {
    expect(KNOWN_PAIRING_POLL_STATUSES).toEqual(["pending", "expired", "slow_down", "approved"]);
    for (const r of [fixtures.pairingPollResponsePending, fixtures.pairingPollResponseExpired, fixtures.pairingPollResponseSlowDown, fixtures.pairingPollResponseApproved]) {
      expect(PairingPollResponseSchema.safeParse(r).success, JSON.stringify(r)).toBe(true);
    }
  });

  it("approved carries exactly enrol's response (reused, not duplicated)", () => {
    const approved = PairingPollResponseSchema.parse(fixtures.pairingPollResponseApproved);
    const { status, ...rest } = approved as { status: string } & Record<string, unknown>;
    expect(status).toBe("approved");
    expect(EnrollResponseSchema.parse(rest)).toEqual(fixtures.agentEnrollResponse);
  });

  it("refuses an approval without the credential, serverId or cadence, and a credential on a non-approved status", () => {
    for (const key of ["agentSecret", "serverId", "cadence"]) {
      const { [key]: _drop, ...partial } = fixtures.pairingPollResponseApproved as Record<string, unknown>;
      expect(PairingPollResponseSchema.safeParse(partial).success, key).toBe(false);
    }
    // Strict: a credential or id on a non-approved status is refused, not stripped.
    for (const bad of [{ status: "pending", agentSecret: "x" }, { status: "expired", serverId: "x" }, { status: "slow_down", cadence: {} }]) {
      expect(PairingPollResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("server names refuse control, bidi and zero-width characters; versions refuse odd characters; caps hold", () => {
    for (const name of ["a\nb", "a‮b", "a​b", "a\u0000b", "a b"]) {
      expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0", serverName: name }).success, JSON.stringify(name)).toBe(false);
    }
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "0.1.0", serverName: "Fabrik äö" }).success).toBe(true);
    expect(PairingStartRequestSchema.safeParse({ agentVersion: "1.0 <b>" }).success).toBe(false);
    expect(PairingLookupResponseSchema.safeParse({ ...fixtures.pairingLookupResponse, serverName: "x".repeat(201) }).success).toBe(false);
    expect(PairingLookupResponseSchema.safeParse({ ...fixtures.pairingLookupResponse, serverName: null }).success).toBe(true);
    expect(PairingStartResponseSchema.safeParse({ ...fixtures.pairingStartResponse, expiresIn: 901 }).success).toBe(false);
    expect(PairingStartResponseSchema.safeParse({ ...fixtures.pairingStartResponse, interval: 61 }).success).toBe(false);
  });

  it("an unknown status, a missing status or a wrong case does not parse (the agent then keeps polling)", () => {
    for (const bad of [{ status: "denied" }, { status: "APPROVED" }, { status: "" }, { status: null }, {}, { agentSecret: "x" }, "approved", null]) {
      expect(PairingPollResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("pairing: dashboard side", () => {
  it("lookup takes a user code in the strict 60-bit shape, nothing else", () => {
    expect(PairingLookupRequestSchema.safeParse(fixtures.pairingLookupRequest).success).toBe(true);
    for (const bad of ["", "AB3D-7XQ2", "ab3d-7xq2-k5mn", "AB3D-7XQ2-K5M1", "AB3D7XQ2K5MN", "AB3D-7XQ2-K5MN\n", "AB3D-7XQ2-K5MN-AB3D", "?code=AB3D-7XQ2-K5MN"]) {
      expect(PairingLookupRequestSchema.safeParse({ userCode: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(endpoints.pairings.lookup).toMatchObject({ method: "POST", route: "/api/pairings/lookup" });
  });

  it("no endpoint takes the code in a URL or query (no prefill)", () => {
    for (const e of [endpoints.pairings.lookup, endpoints.pairings.approve, endpoints.agentApi.startPairing, endpoints.agentApi.pollPairing]) {
      expect(e.route).not.toMatch(/:|\?/);
      expect("query" in e).toBe(false);
    }
  });

  it("approve takes a new or an existing target and refuses everything else", () => {
    expect(PairingApproveRequestSchema.safeParse(fixtures.pairingApproveRequestNew).success).toBe(true);
    expect(PairingApproveRequestSchema.safeParse(fixtures.pairingApproveRequestExisting).success).toBe(true);
    const code = "AB3D-7XQ2-K5MN";
    for (const target of [{ kind: "existing" }, { kind: "existing", serverId: "Not A Server" }, { kind: "new", serverId: "default" }, { kind: "other" }, {}, null, "new"]) {
      expect(PairingApproveRequestSchema.safeParse({ userCode: code, target }).success, JSON.stringify(target)).toBe(false);
    }
    expect(PairingApproveRequestSchema.safeParse({ userCode: code }).success).toBe(false);
    expect(endpoints.pairings.approve).toMatchObject({ method: "POST", route: "/api/pairings/approve" });
  });
});

describe("compat block", () => {
  it("parses the fixture, with an advisory and without", () => {
    expect(CompatResponseSchema.safeParse(fixtures.compatResponse).success).toBe(true);
    expect(fixtures.compatResponse.agent.advisories).toEqual([]);
  });

  it("is GET /api/compat, with no request", () => {
    expect(endpoints.compat).toMatchObject({ method: "GET", route: "/api/compat" });
    expect("request" in endpoints.compat).toBe(false);
  });

  it("needs both components and every field", () => {
    const { agent: _agent, ...onlyMod } = fixtures.compatResponse;
    expect(CompatResponseSchema.safeParse(onlyMod).success).toBe(false);
    for (const key of ["current", "minSupported", "minSafe", "advisories"]) {
      const { [key]: _drop, ...partial } = fixtures.compatResponse.mod as Record<string, unknown>;
      expect(CompatResponseSchema.safeParse({ ...fixtures.compatResponse, mod: partial }).success, key).toBe(false);
    }
  });

  it("versions are MAJOR.MINOR.PATCH with an optional prerelease", () => {
    for (const ok of ["0.0.0", "1.2.3", "10.20.30", "1.2.3-rc.1", "1.0.0-beta"]) expect(CompatVersionSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "1", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-", "1.2.3 ", "1.2.3\n", "-1.2.3", "1.2.3+build"]) {
      expect(CompatVersionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("ranges are comparators joined by spaces, sets by ' || '", () => {
    for (const ok of [">=1.0.0 <1.1.0", "<1.1.0", "=2.0.0", "2.0.0", ">1.0.0", "<=1.2.3-rc.1", ">=1.0.0 <1.1.0 || >=2.0.0 <2.0.5"]) {
      expect(CompatRangeSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["", "*", "1.x", "^1.0.0", "~1.0.0", ">= 1.0.0", ">=1.0.0  <1.1.0", " >=1.0.0", ">=1.0.0 ", ">=1.0.0 ||", "|| >=1.0.0", ">=1.0.0 | <2.0.0", "=>1.0.0", ">>1.0.0", ">=1.0.0\n", "1.0.0 - 2.0.0", "<" + "9".repeat(250)]) {
      expect(CompatRangeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a hostile range cannot make the matcher backtrack for long", () => {
    const started = Date.now();
    CompatRangeSchema.safeParse(">=1.0.0 ".repeat(25) + "!");
    CompatRangeSchema.safeParse("1.0.0 || ".repeat(20) + "x");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("an advisory needs a clean id, a range, a fixed version and a bounded summary", () => {
    const adv = fixtures.compatResponse.mod.advisories[0]!;
    const withAdv = (a: unknown) => CompatResponseSchema.safeParse({ ...fixtures.compatResponse, mod: { ...fixtures.compatResponse.mod, advisories: [a] } }).success;
    expect(withAdv(adv)).toBe(true);
    expect(withAdv({ ...adv, id: "has space" })).toBe(false);
    expect(withAdv({ ...adv, id: "" })).toBe(false);
    expect(withAdv({ ...adv, affected: "all" })).toBe(false);
    expect(withAdv({ ...adv, fixed: "soon" })).toBe(false);
    expect(withAdv({ ...adv, summary: "x".repeat(501) })).toBe(false);
    expect(withAdv({ ...adv, fixed: undefined })).toBe(false);
  });

  it("unknown extra fields are stripped (additive: a newer backend must not break an older reader)", () => {
    const parsed = CompatResponseSchema.parse({ ...fixtures.compatResponse, future: 1, mod: { ...fixtures.compatResponse.mod, later: true } });
    expect(parsed).toEqual(fixtures.compatResponse);
  });
});
